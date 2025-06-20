# HMA Plugin Configuration and Setup Guide

## Overview

The HMA (Hash-Match-Action) Plugin for Mjolnir provides automated CSAM (Child Sexual Abuse Material) detection by hashing media content and comparing it against external databases. This plugin implements multiple hashing algorithms and provides comprehensive monitoring and rate limiting capabilities for production environments.

## Features

- **Multi-Hash Support**: MD5, SHA1, SHA256, and PDQ (stubbed for future implementation)
- **Comprehensive Media Coverage**: Images, videos, files, audio, and stickers
- **Production-Ready**: Rate limiting, concurrent request management, metrics tracking
- **Flexible Configuration**: Plugin settings override config file settings
- **Robust Error Handling**: Fail-open behavior, detailed logging, timeout management
- **Security Integration**: Automatic quarantine of detected content
- **Management Room Alerts**: Real-time notifications for detected content

## Configuration

### Basic Configuration

Add the following to your `config/default.yaml`:

```yaml
# HMA (Hash-Match-Action) service configuration for CSAM detection
hma:
  # URL of the HMA service endpoint (leave empty to disable)
  url: "https://your-hma-service.example.com/api/v1/check"
  
  # Whether HMA scanning is enabled (default: false)
  enabled: true
```

### Plugin Settings

The HMA plugin provides granular control through protection settings that can be configured via Mjolnir commands:

```
# Enable/disable the plugin
!mjolnir protections config HMAPlugin enabled true

# Set service URL (overrides config file)
!mjolnir protections config HMAPlugin serviceUrl "https://your-service.com/api/check"

# Configure timeout (milliseconds)
!mjolnir protections config HMAPlugin timeoutMs 15000

# Set rate limiting (requests per minute)
!mjolnir protections config HMAPlugin rateLimitPerMinute 60

# Configure concurrent request limit
!mjolnir protections config HMAPlugin maxConcurrentRequests 3

# Enable/disable detailed logging (privacy consideration)
!mjolnir protections config HMAPlugin logSuccessfulScans false

# Enable/disable automatic quarantine of blocked media
!mjolnir protections config HMAPlugin quarantineOnBlock true
```

### Configuration Hierarchy

Plugin settings take precedence over config file settings:

1. **Plugin Settings** (highest priority) - Set via `!mjolnir protections config`
2. **Config File** - Set in `config/default.yaml`
3. **Defaults** - Built-in fallback values

## HMA Service Integration

### Request Format

The plugin sends the following JSON payload to your HMA service:

```json
{
  "hashes": {
    "md5": "5d41402abc4b2a76b9719d911017c592",
    "sha1": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", 
    "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
    "pdq": "stubbed_pdq_placeholder_aaf4c61ddcc5e8a2"
  },
  "eventId": "$event123:example.com",
  "roomId": "!room456:example.com", 
  "userId": "@user:example.com",
  "mediaType": "m.image",
  "timestamp": 1703123456789
}
```

### Response Format

Your HMA service should respond with:

```json
{
  "action": "block",  // "allow" or "block"
  "reason": "CSAM detected via PhotoDNA",
  "matchedHash": "5d41402abc4b2a76b9719d911017c592",
  "hashType": "md5",
  "confidence": 0.95  // Optional: 0.0-1.0 confidence score
}
```

### Service Requirements

- **Timeout**: Service must respond within configured timeout (default: 10 seconds)
- **Rate Limiting**: Service should handle the configured rate limit (default: 100 req/min)
- **Error Handling**: Return appropriate HTTP status codes for errors
- **Security**: Use HTTPS for all communications

## Monitoring and Metrics

### Built-in Metrics

Access metrics via the plugin interface:

```javascript
// Get current metrics
const metrics = hmaPlugin.getMetrics();
console.log(metrics);

// Reset metrics
hmaPlugin.resetMetrics();
```

Metrics include:
- **totalRequests**: Total HMA service requests made
- **successfulRequests**: Requests that completed successfully  
- **blockedContent**: Content blocked due to positive matches
- **allowedContent**: Content allowed after scanning
- **errors**: Failed requests (network, service errors)
- **timeouts**: Requests that exceeded timeout
- **averageResponseTime**: Average response time in milliseconds
- **lastRequestTime**: Timestamp of last request

### Logging

The plugin provides structured logging at multiple levels:

```
INFO  - HMAPlugin: Processing media from @user:example.com in !room:example.com: mxc://server/media (m.image)
DEBUG - HMAPlugin: Downloaded 1048576 bytes for mxc://server/media  
DEBUG - HMAPlugin: Generated hashes for mxc://server/media: MD5=5d41402a..., SHA1=aaf4c61d..., SHA256=2c26b46b..., PDQ=stubbed_pdq_placeholder_aaf4c61d
WARN  - HMAPlugin: 🚨 CSAM Detection: Blocking media from @user:example.com in !room:example.com: CSAM detected via PhotoDNA (matched md5: 5d41402a...) [confidence: 95.0%]
ERROR - HMAPlugin: HMA service error 500: Internal Server Error for mxc://server/media
```

### Management Room Alerts

Critical events are automatically logged to the management room:

```
🚨 CSAM Detection: Blocking media from @user:example.com in !room:example.com: CSAM detected via PhotoDNA (matched md5: 5d41402a...) [confidence: 95.0%]
```

## Rate Limiting and Performance

### Rate Limiting Algorithm

The plugin uses a token bucket algorithm:

- **Bucket Size**: Equal to `rateLimitPerMinute` setting
- **Refill Rate**: Tokens added continuously based on rate limit
- **Burst Handling**: Allows temporary bursts up to bucket size

### Concurrent Request Management

- **Limit**: Configurable maximum concurrent requests (default: 5)
- **Queuing**: Requests exceeding limit are skipped with warning
- **Tracking**: Per-request lifecycle management

### Performance Considerations

- **Media Size**: Large media files increase processing time
- **Network Latency**: Factor in round-trip time to HMA service
- **Rate Limits**: Balance thoroughness with service capacity
- **Fail-Open**: Errors don't block legitimate content

## Security Considerations

### Privacy

- **Hash-Only**: Only cryptographic hashes are sent, not actual media
- **Logging Control**: `logSuccessfulScans` setting controls detailed logging
- **Data Retention**: Consider HMA service data retention policies

### Quarantine Integration

When `quarantineOnBlock` is enabled and Mjolnir has admin privileges:

1. Detected media is automatically quarantined via Synapse admin API
2. Quarantine prevents further access to the content
3. Failures to quarantine are logged but don't prevent redaction

### Access Control

- **Service Authentication**: Implement authentication for HMA service
- **Network Security**: Use VPN or private networks when possible
- **Audit Logging**: Monitor all HMA service interactions

## Troubleshooting

### Common Issues

#### Plugin Not Processing Media

**Symptoms**: No HMA requests being made

**Checks**:
```bash
# Verify plugin is enabled
!mjolnir protections list | grep HMAPlugin

# Check configuration
!mjolnir protections config HMAPlugin enabled
!mjolnir protections config HMAPlugin serviceUrl

# Verify media events are occurring
# Check Mjolnir logs for "Processing media" messages
```

#### High Error Rates

**Symptoms**: Many timeout or error messages

**Solutions**:
```bash
# Increase timeout
!mjolnir protections config HMAPlugin timeoutMs 20000

# Reduce rate limit
!mjolnir protections config HMAPlugin rateLimitPerMinute 30

# Reduce concurrent requests  
!mjolnir protections config HMAPlugin maxConcurrentRequests 2
```

#### Service Authentication Failures

**Symptoms**: HTTP 401/403 errors

**Solutions**:
- Verify HMA service credentials
- Check service URL configuration
- Review firewall/network access rules

### Debug Mode

Enable detailed logging:

```bash
# Enable successful scan logging (privacy consideration)
!mjolnir protections config HMAPlugin logSuccessfulScans true

# Check Mjolnir log level
# Ensure log level is DEBUG or INFO in config
```

### Health Checks

Monitor plugin health via metrics:

```bash
# Check error rate
error_rate = errors / totalRequests

# Monitor average response time
avg_response_time < timeout_threshold

# Verify recent activity
time_since_last_request = now - lastRequestTime
```

## API Reference

### Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable the plugin |
| `serviceUrl` | string | `""` | HMA service endpoint URL |
| `timeoutMs` | number | `10000` | Request timeout in milliseconds |
| `rateLimitPerMinute` | number | `100` | Maximum requests per minute |
| `maxConcurrentRequests` | number | `5` | Maximum concurrent requests |
| `logSuccessfulScans` | boolean | `false` | Log successful scans (privacy consideration) |
| `quarantineOnBlock` | boolean | `true` | Auto-quarantine blocked media |

### Supported Media Types

- `m.image` - Images (JPEG, PNG, GIF, etc.)
- `m.video` - Video files  
- `m.file` - Generic file uploads
- `m.audio` - Audio files
- `m.sticker` - Matrix stickers

### Hash Algorithms

- **MD5**: Legacy, widely supported
- **SHA1**: Legacy, widely supported  
- **SHA256**: Modern, recommended
- **PDQ**: Perceptual hashing (stubbed, future implementation)

## Migration and Updates

### Updating Configuration

Configuration changes take effect immediately:

```bash
# Update settings
!mjolnir protections config HMAPlugin rateLimitPerMinute 50

# Verify changes
!mjolnir protections config HMAPlugin rateLimitPerMinute
```

### Service Migration

When changing HMA services:

1. Update service URL
2. Test with a few media items
3. Monitor error rates
4. Update authentication if needed

### Performance Tuning

Based on deployment size:

**Small Deployments** (< 100 users):
- `rateLimitPerMinute`: 60
- `maxConcurrentRequests`: 3
- `timeoutMs`: 10000

**Medium Deployments** (100-1000 users):
- `rateLimitPerMinute`: 100  
- `maxConcurrentRequests`: 5
- `timeoutMs`: 15000

**Large Deployments** (> 1000 users):
- `rateLimitPerMinute`: 200
- `maxConcurrentRequests`: 10
- `timeoutMs`: 20000

## Support

### Logs to Collect

When reporting issues:

1. Mjolnir configuration (sanitized)
2. Plugin settings output
3. Error messages from logs
4. HMA service response examples
5. Network/connectivity information

### Performance Data

Include metrics:
- Request volumes
- Error rates  
- Response times
- Concurrent usage patterns

For additional support, refer to the main Mjolnir documentation and community channels. 