import { Mjolnir } from "../../Mjolnir";
import { Protection } from "../../protections/IProtection";
import { AbstractProtectionSetting, BooleanProtectionSetting, NumberProtectionSetting, StringProtectionSetting } from "../../protections/ProtectionSettings";
import { Consequence, ConsequenceRedact } from "../../protections/consequence";
import { LogLevel, LogService } from "@vector-im/matrix-bot-sdk";
import axios from "axios";
import * as crypto from "crypto";

interface HMAHashData {
    md5: string;
    sha1: string;
    sha256: string;
    pdq: string; // Stubbed for now - will be replaced with actual PDQ implementation
}

interface HMARequest {
    hashes: HMAHashData;
    eventId: string;
    roomId: string;
    userId: string;
    mediaType: string;
    timestamp: number;
}

interface HMAResponse {
    action: "allow" | "block";
    reason?: string;
    matchedHash?: string;
    hashType?: string;
    confidence?: number;
}

interface HMAMetrics {
    totalRequests: number;
    successfulRequests: number;
    blockedContent: number;
    allowedContent: number;
    errors: number;
    timeouts: number;
    averageResponseTime: number;
    lastRequestTime: number;
}

interface RateLimitBucket {
    tokens: number;
    lastRefill: number;
}

export class HMAPlugin extends Protection {
    public readonly name = "HMAPlugin";
    public readonly description = "Hashes media and sends it to an external service for CSAM analysis using MD5, SHA1, SHA256, and PDQ hashes.";
    
    settings = {
        enabled: new BooleanProtectionSetting(),
        serviceUrl: new StringProtectionSetting(),
        timeoutMs: new NumberProtectionSetting(10000, 1000), // 10 second default, minimum 1 second
        rateLimitPerMinute: new NumberProtectionSetting(100, 1), // 100 requests per minute default
        maxConcurrentRequests: new NumberProtectionSetting(5, 1), // 5 concurrent requests max
        logSuccessfulScans: new BooleanProtectionSetting(), // Don't log successful scans by default for privacy
        quarantineOnBlock: new BooleanProtectionSetting(), // Quarantine blocked media
    };

    private readonly supportedMediaTypes = new Set([
        "m.image",
        "m.video", 
        "m.file",
        "m.audio",
        "m.sticker"
    ]);

    // Rate limiting
    private rateLimitBucket: RateLimitBucket = { tokens: 0, lastRefill: Date.now() };
    private concurrentRequests = 0;

    // Metrics tracking
    private metrics: HMAMetrics = {
        totalRequests: 0,
        successfulRequests: 0,
        blockedContent: 0,
        allowedContent: 0,
        errors: 0,
        timeouts: 0,
        averageResponseTime: 0,
        lastRequestTime: 0
    };

    private responseTimeSum = 0;

    constructor() {
        super();
        // Initialize rate limit bucket
        this.refillRateLimitBucket();
        
        // Set default values for settings
        this.settings.enabled.setValue(false);
        this.settings.serviceUrl.setValue("");
        this.settings.logSuccessfulScans.setValue(false);
        this.settings.quarantineOnBlock.setValue(true);
    }

    private refillRateLimitBucket(): void {
        const now = Date.now();
        const timePassed = now - this.rateLimitBucket.lastRefill;
        const tokensToAdd = Math.floor(timePassed / (60000 / this.settings.rateLimitPerMinute.value));
        
        if (tokensToAdd > 0) {
            this.rateLimitBucket.tokens = Math.min(
                this.settings.rateLimitPerMinute.value,
                this.rateLimitBucket.tokens + tokensToAdd
            );
            this.rateLimitBucket.lastRefill = now;
        }
    }

    private canMakeRequest(): boolean {
        this.refillRateLimitBucket();
        
        if (this.rateLimitBucket.tokens <= 0) {
            LogService.warn("HMAPlugin", `Rate limit exceeded: ${this.settings.rateLimitPerMinute.value} requests per minute`);
            return false;
        }
        
        if (this.concurrentRequests >= this.settings.maxConcurrentRequests.value) {
            LogService.warn("HMAPlugin", `Concurrent request limit exceeded: ${this.settings.maxConcurrentRequests.value} concurrent requests`);
            return false;
        }
        
        return true;
    }

    private consumeRateLimit(): void {
        this.rateLimitBucket.tokens--;
    }

    private updateMetrics(startTime: number, success: boolean, blocked: boolean = false, error: string = ""): void {
        const responseTime = Date.now() - startTime;
        this.metrics.totalRequests++;
        this.metrics.lastRequestTime = Date.now();
        
        if (success) {
            this.metrics.successfulRequests++;
            if (blocked) {
                this.metrics.blockedContent++;
            } else {
                this.metrics.allowedContent++;
            }
            
            // Update average response time
            this.responseTimeSum += responseTime;
            this.metrics.averageResponseTime = Math.round(this.responseTimeSum / this.metrics.successfulRequests);
        } else {
            this.metrics.errors++;
            if (error.includes("timeout")) {
                this.metrics.timeouts++;
            }
        }
    }

    public getMetrics(): HMAMetrics {
        return { ...this.metrics };
    }

    public resetMetrics(): void {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            blockedContent: 0,
            allowedContent: 0,
            errors: 0,
            timeouts: 0,
            averageResponseTime: 0,
            lastRequestTime: 0
        };
        this.responseTimeSum = 0;
    }

    private generateHashes(mediaData: Buffer): HMAHashData {
        return {
            md5: crypto.createHash("md5").update(mediaData).digest("hex"),
            sha1: crypto.createHash("sha1").update(mediaData).digest("hex"),
            sha256: crypto.createHash("sha256").update(mediaData).digest("hex"),
            pdq: "stubbed_pdq_placeholder_" + crypto.createHash("sha1").update(mediaData).digest("hex").substring(0, 16)
        };
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        // Check if plugin is enabled
        if (!this.settings.enabled.value) {
            return;
        }

        // Check if this is a media message we should process
        if (event.type !== "m.room.message" && event.type !== "m.sticker") {
            return;
        }

        const msgtype = event.content?.msgtype;
        if (!this.supportedMediaTypes.has(msgtype) && event.type !== "m.sticker") {
            return;
        }

        // Get the MXC URL from the event
        const mxcUrl = event.content?.url;
        if (!mxcUrl || !mxcUrl.startsWith("mxc://")) {
            return;
        }

        // Check service URL configuration
        const serviceUrl = this.settings.serviceUrl.value || mjolnir.config.hma?.url;
        if (!serviceUrl) {
            LogService.debug("HMAPlugin", "HMA service URL not configured, skipping hash analysis");
            return;
        }

        // Check rate limiting
        if (!this.canMakeRequest()) {
            LogService.warn("HMAPlugin", `Skipping HMA scan for ${mxcUrl} due to rate limiting`);
            return;
        }

        const startTime = Date.now();
        this.concurrentRequests++;
        this.consumeRateLimit();

        try {
            LogService.info("HMAPlugin", `Processing media from ${event.sender} in room ${roomId}: ${mxcUrl} (${msgtype || "sticker"})`);

            // Download media using proper Matrix client method
            const mediaResponse = await mjolnir.client.downloadContent(mxcUrl);
            const mediaData = Buffer.from(mediaResponse.data);

            LogService.debug("HMAPlugin", `Downloaded ${mediaData.length} bytes for ${mxcUrl}`);

            // Generate all required hashes
            const hashes = this.generateHashes(mediaData);
            
            if (this.settings.logSuccessfulScans.value) {
                LogService.debug("HMAPlugin", `Generated hashes for ${mxcUrl}: MD5=${hashes.md5.substring(0,8)}..., SHA1=${hashes.sha1.substring(0,8)}..., SHA256=${hashes.sha256.substring(0,8)}..., PDQ=${hashes.pdq}`);
            }

            // Prepare HMA request
            const hmaRequest: HMARequest = {
                hashes,
                eventId: event.event_id,
                roomId,
                userId: event.sender,
                mediaType: msgtype || "m.sticker",
                timestamp: Date.now()
            };

            // Send to HMA service
            const hmaResponse = await axios.post<HMAResponse>(serviceUrl, hmaRequest, {
                timeout: this.settings.timeoutMs.value,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mjolnir-HMA-Plugin/1.0'
                }
            });

            const blocked = hmaResponse.data.action === "block";
            this.updateMetrics(startTime, true, blocked);

            if (this.settings.logSuccessfulScans.value) {
                LogService.info("HMAPlugin", `HMA service response for ${mxcUrl}: action=${hmaResponse.data.action}, reason=${hmaResponse.data.reason || 'none'}, confidence=${hmaResponse.data.confidence || 'unknown'}`);
            }

            if (blocked) {
                const reason = hmaResponse.data.reason || "Blocked by HMA service";
                const matchInfo = hmaResponse.data.matchedHash ? 
                    ` (matched ${hmaResponse.data.hashType}: ${hmaResponse.data.matchedHash.substring(0, 8)}...)` : "";
                const confidenceInfo = hmaResponse.data.confidence ? 
                    ` [confidence: ${(hmaResponse.data.confidence * 100).toFixed(1)}%]` : "";
                
                await mjolnir.managementRoomOutput.logMessage(
                    LogLevel.WARN,
                    "HMAPlugin",
                    `🚨 CSAM Detection: Blocking media from ${event.sender} in ${roomId}: ${reason}${matchInfo}${confidenceInfo}`
                );

                // Quarantine media if enabled
                if (this.settings.quarantineOnBlock.value && mjolnir.config.admin) {
                    try {
                        const mxcParsed = mxcUrl.replace('mxc://', '').split('/');
                        if (mxcParsed.length >= 2) {
                            await mjolnir.client.doRequest("POST", `/_synapse/admin/v1/media/${mxcParsed[0]}/${mxcParsed[1]}/quarantine`);
                            LogService.info("HMAPlugin", `Quarantined media: ${mxcUrl}`);
                        }
                    } catch (quarantineError) {
                        LogService.warn("HMAPlugin", `Failed to quarantine media ${mxcUrl}:`, quarantineError);
                    }
                }

                return new ConsequenceRedact(`${reason}${matchInfo}${confidenceInfo}`);
            } else {
                LogService.debug("HMAPlugin", `Media allowed: ${mxcUrl}`);
            }

        } catch (error) {
            let errorType = "unknown";
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    errorType = "timeout";
                    LogService.warn("HMAPlugin", `HMA service timeout (${this.settings.timeoutMs.value}ms) for ${mxcUrl}`);
                } else if (error.response) {
                    errorType = "response_error";
                    LogService.error("HMAPlugin", `HMA service error ${error.response.status}: ${error.response.statusText} for ${mxcUrl}`);
                } else {
                    errorType = "network_error";
                    LogService.error("HMAPlugin", `HMA service network error: ${error.message} for ${mxcUrl}`);
                }
            } else {
                errorType = "processing_error";
                LogService.error("HMAPlugin", `Error processing media ${mxcUrl}:`, error);
            }
            
            this.updateMetrics(startTime, false, false, errorType);
            
            // Don't block on errors - fail open for availability
            return;
        } finally {
            this.concurrentRequests--;
        }
    }
} 