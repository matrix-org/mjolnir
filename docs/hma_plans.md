# HMA Integration Plans: Real CSAM Detection via ThreatExchange

## Executive Summary

This document outlines the integration plan for connecting Mjolnir's HMA Plugin to real CSAM (Child Sexual Abuse Material) detection services through Facebook's ThreatExchange HMA (Hasher-Matcher-Actioner) system, which provides seamless integration with NCMEC's Hash Sharing API.

**Current Status**: Mjolnir HMA Plugin is production-ready but connected to placeholder endpoints  
**Goal**: Enable real-time CSAM detection using authoritative hash databases  
**Solution**: Deploy Facebook ThreatExchange HMA as middleware service  
**Timeline**: Can be implemented immediately with proper credentials and deployment

## Background

### Problem Statement
Our Mjolnir HMA Plugin is fully functional but lacks connection to real CSAM detection services. While NCMEC provides the authoritative Hash Sharing API for CSAM detection, it uses XML-based queries rather than the real-time JSON API our plugin expects.

### Solution Discovery
Facebook's ThreatExchange HMA system provides the perfect bridge:
- **Built-in NCMEC Integration**: Native support for NCMEC Hash Sharing API
- **API Compatibility**: Provides exactly the REST API format our plugin expects  
- **Production Ready**: Used by major platforms for real CSAM detection
- **Open Source**: Available for self-deployment and customization

## Architecture Overview

### Current Implementation
```
Matrix Media Event → Mjolnir → HMA Plugin → Placeholder Endpoint
```

### Target Architecture
```
Matrix Media Event → Mjolnir → HMA Plugin → ThreatExchange HMA → NCMEC Hash Sharing API
                                             ↓
                                    Additional Hash Sources
                                    (PhotoDNA, PDQ, etc.)
```

### Component Responsibilities

**Mjolnir HMA Plugin**:
- Media detection and download
- Hash generation (MD5, SHA1, SHA256, PDQ)
- Rate limiting and error handling
- Matrix-specific quarantine and redaction

**ThreatExchange HMA**:
- NCMEC API authentication and integration
- Hash database queries and caching
- Response aggregation from multiple sources
- Production-grade monitoring and logging

**NCMEC Hash Sharing API**:
- Authoritative CSAM hash database
- PhotoDNA, PDQ, and cryptographic hash storage
- Industry, Law Enforcement, and NPO data sharing

## Integration Compatibility

### API Format Match

**Our Plugin Sends**:
```json
{
  "hashes": {
    "md5": "5d41402abc4b2a76b9719d911017c592",
    "sha1": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706",
    "pdq": "stubbed_pdq_placeholder_aaf4c61ddcc5e8a2"
  },
  "eventId": "$event123:example.com",
  "roomId": "!room456:example.com",
  "userId": "@user:example.com",
  "mediaType": "m.image",
  "timestamp": 1703123456789
}
```

**ThreatExchange HMA Returns**:
```json
{
  "action": "block",
  "reason": "CSAM detected via NCMEC PhotoDNA",
  "matchedHash": "5d41402abc4b2a76b9719d911017c592",
  "hashType": "md5",
  "confidence": 0.95,
  "source": "ncmec_industry"
}
```

### Hash Algorithm Support

| Algorithm | Our Plugin | ThreatExchange | NCMEC API |
|-----------|------------|----------------|-----------|
| MD5 | ✅ | ✅ | ✅ |
| SHA1 | ✅ | ✅ | ✅ |
| SHA256 | ✅ | ✅ | ❌ |
| PDQ | 🔄 Stubbed | ✅ | ✅ |
| PhotoDNA | ❌ | ✅ | ✅ |
| NetClean | ❌ | ✅ | ✅ |

## Deployment Options

### Option 1: Self-Hosted ThreatExchange HMA (Recommended)

**Advantages**:
- Full control over deployment and configuration
- Custom authentication and rate limiting
- Enhanced privacy and data residency
- Integration with internal monitoring systems

**Requirements**:
- NCMEC Hash Sharing API credentials
- Container orchestration platform (Kubernetes/Docker)
- HTTPS endpoint with proper certificates
- Monitoring and logging infrastructure

**Implementation Steps**:
1. **Repository Setup**:
   ```bash
   git clone https://github.com/facebook/ThreatExchange.git
   cd ThreatExchange/hasher-matcher-actioner
   ```

2. **NCMEC Credential Configuration**:
   ```yaml
   # config/ncmec.yaml
   ncmec:
     industry_csam:
       base_url: "https://report.cybertip.org/hashsharing"
       username: "your-industry-username"
       password: "your-industry-password"
     npo_csam:
       base_url: "https://hashsharing.ncmec.org/npo"
       username: "your-npo-username"
       password: "your-npo-password"
   ```

3. **Service Deployment**:
   ```bash
   docker build -t hma-service .
   docker run -d -p 8080:8080 \
     -v $(pwd)/config:/app/config \
     hma-service
   ```

4. **Mjolnir Configuration**:
   ```bash
   !mjolnir protections config HMAPlugin serviceUrl "https://your-hma.example.com/api/v1/hash-lookup"
   !mjolnir protections config HMAPlugin enabled true
   ```

### Option 2: Hosted ThreatExchange Service

**Advantages**:
- No infrastructure management
- Automatic updates and maintenance
- Shared rate limiting and caching

**Requirements**:
- Service availability from Facebook/Meta
- API key registration process
- Network connectivity to hosted endpoints

**Implementation**:
```bash
# If hosted service becomes available
!mjolnir protections config HMAPlugin serviceUrl "https://threatexchange-hma.meta.com/api/v1/check"
!mjolnir protections config HMAPlugin apiKey "your-threatexchange-api-key"
!mjolnir protections config HMAPlugin enabled true
```

### Option 3: Hybrid Deployment

**Advantages**:
- Primary service with fallback options
- Load distribution across multiple sources
- Enhanced reliability and coverage

**Architecture**:
```
HMA Plugin → Load Balancer → [ThreatExchange HMA, Custom NCMEC Service, Commercial API]
```

## Implementation Plan

### Phase 1: NCMEC Access and Credentials (Week 1)

**Objective**: Obtain NCMEC Hash Sharing API access

**Tasks**:
1. **Organization Registration**:
   - Submit application to NCMEC for Hash Sharing API access
   - Specify organization type (Industry/NPO/Law Enforcement)
   - Provide technical contact information and use case details

2. **Environment Selection**:
   - Choose appropriate environment (Industry CSAM, NPO CSAM, etc.)
   - Request both test and production credentials
   - Understand access permissions (read-only vs read/write)

3. **Credential Testing**:
   - Verify authentication with NCMEC test environment
   - Test basic query functionality
   - Validate rate limits and access permissions

**Deliverables**:
- NCMEC API credentials for test and production
- Documented API access permissions
- Test query results validation

### Phase 2: ThreatExchange HMA Deployment (Week 2)

**Objective**: Deploy and configure ThreatExchange HMA service

**Tasks**:
1. **Infrastructure Setup**:
   ```bash
   # Clone and prepare ThreatExchange repository
   git clone https://github.com/facebook/ThreatExchange.git
   cd ThreatExchange/hasher-matcher-actioner
   
   # Review deployment documentation
   cat README.md
   ```

2. **Configuration Management**:
   ```yaml
   # Create production configuration
   services:
     ncmec:
       enabled: true
       endpoints:
         - name: "industry_csam"
           url: "https://report.cybertip.org/hashsharing"
           auth_type: "basic"
           username: "${NCMEC_INDUSTRY_USERNAME}"
           password: "${NCMEC_INDUSTRY_PASSWORD}"
   
   api:
     port: 8080
     rate_limit: 100  # requests per minute
     timeout: 10000   # milliseconds
   
   logging:
     level: "INFO"
     format: "json"
   ```

3. **Security Configuration**:
   ```bash
   # Generate TLS certificates
   openssl req -x509 -newkey rsa:4096 -keyout hma-key.pem -out hma-cert.pem -days 365
   
   # Configure firewall rules
   ufw allow from mjolnir-server-ip to any port 8080
   ```

4. **Service Deployment**:
   ```yaml
   # docker-compose.yml
   version: '3.8'
   services:
     hma-service:
       build: .
       ports:
         - "8080:8080"
       environment:
         - NCMEC_INDUSTRY_USERNAME=${NCMEC_INDUSTRY_USERNAME}
         - NCMEC_INDUSTRY_PASSWORD=${NCMEC_INDUSTRY_PASSWORD}
       volumes:
         - ./config:/app/config
         - ./logs:/app/logs
       restart: unless-stopped
   ```

**Deliverables**:
- Running ThreatExchange HMA service
- Verified NCMEC integration functionality
- Production-ready configuration and monitoring

### Phase 3: Integration Testing (Week 3)

**Objective**: Integrate Mjolnir HMA Plugin with ThreatExchange HMA

**Tasks**:
1. **Plugin Configuration**:
   ```bash
   # Configure Mjolnir to use ThreatExchange HMA
   !mjolnir protections config HMAPlugin serviceUrl "https://hma.your-domain.com/api/v1/hash-lookup"
   !mjolnir protections config HMAPlugin enabled true
   !mjolnir protections config HMAPlugin timeoutMs 15000
   !mjolnir protections config HMAPlugin rateLimitPerMinute 50
   ```

2. **End-to-End Testing**:
   ```bash
   # Test with known test images (if available from NCMEC)
   # Upload test media to monitored Matrix room
   # Verify hash generation and submission
   # Confirm HMA service response handling
   # Validate quarantine functionality
   ```

3. **Performance Monitoring**:
   ```bash
   # Monitor plugin metrics
   # Check HMA service response times
   # Verify error handling and fallback behavior
   # Validate rate limiting effectiveness
   ```

4. **Security Validation**:
   ```bash
   # Verify HTTPS communication
   # Confirm authentication handling
   # Test quarantine permissions
   # Validate logging and audit trails
   ```

**Deliverables**:
- Successful end-to-end CSAM detection
- Performance metrics and optimization recommendations
- Security audit results and compliance documentation

### Phase 4: Production Deployment (Week 4)

**Objective**: Deploy to production with monitoring and alerting

**Tasks**:
1. **Production Configuration**:
   ```yaml
   # Production HMA service configuration
   production:
     ncmec:
       base_url: "https://report.cybertip.org/hashsharing"  # Production NCMEC
       rate_limit: 100
       timeout: 10000
     
     monitoring:
       metrics_enabled: true
       health_check_interval: 30
       alert_webhook: "https://your-monitoring.com/webhook"
   ```

2. **Monitoring Setup**:
   ```bash
   # Configure monitoring for:
   # - HMA service uptime and response times
   # - NCMEC API rate limiting and errors
   # - Plugin metrics and detection rates
   # - False positive/negative analysis
   ```

3. **Alerting Configuration**:
   ```yaml
   alerts:
     - name: "hma_service_down"
       condition: "http_status != 200"
       action: "immediate_alert"
     
     - name: "csam_detection"
       condition: "action == 'block'"
       action: "security_team_alert"
     
     - name: "high_error_rate" 
       condition: "error_rate > 5%"
       action: "ops_team_alert"
   ```

4. **Documentation and Training**:
   - Operations runbook for HMA service management
   - Incident response procedures for CSAM detections
   - Monitoring dashboard setup and interpretation
   - Staff training on CSAM handling procedures

**Deliverables**:
- Production-ready CSAM detection system
- Complete monitoring and alerting setup
- Operations documentation and procedures
- Staff training completion

## Security and Privacy Considerations

### Data Protection
- **Hash-Only Transmission**: Only cryptographic hashes sent to external services
- **No Media Storage**: Original media not retained by HMA services
- **Audit Logging**: Comprehensive logs for compliance and investigation
- **Access Controls**: Role-based access to HMA service and configurations

### Privacy Controls
```bash
# Configure privacy-conscious settings
!mjolnir protections config HMAPlugin logSuccessfulScans false  # Reduce logging
!mjolnir protections config HMAPlugin quarantineOnBlock true   # Auto-quarantine
```

### Compliance Requirements
- **Data Residency**: Consider hosting HMA service in appropriate jurisdiction
- **Retention Policies**: Configure log retention according to legal requirements
- **Access Auditing**: Monitor and log all administrative access
- **Incident Reporting**: Establish procedures for CSAM detection incidents

## Monitoring and Metrics

### Key Performance Indicators

**Detection Metrics**:
- CSAM detection rate (blocks per total scans)
- False positive rate (manual review outcomes)
- Response time from hash generation to decision
- Hash database coverage and freshness

**Operational Metrics**:
- HMA service uptime and availability
- NCMEC API response times and error rates
- Plugin processing times and throughput
- Rate limiting effectiveness and queue depths

**Security Metrics**:
- Authentication success/failure rates
- Quarantine action success rates
- Incident response times
- Compliance audit results

### Monitoring Dashboard

```yaml
# Grafana dashboard configuration
dashboard:
  panels:
    - title: "CSAM Detection Rate"
      query: "rate(csam_blocks_total[5m])"
    
    - title: "HMA Service Response Time"
      query: "histogram_quantile(0.95, hma_request_duration_seconds)"
    
    - title: "NCMEC API Status"
      query: "up{service='ncmec-api'}"
    
    - title: "Error Rate"
      query: "rate(http_requests_total{status=~'5..'}[5m])"
```

## Risk Assessment and Mitigation

### Technical Risks

**Risk**: HMA service becomes unavailable  
**Impact**: No CSAM detection during outage  
**Mitigation**: 
- Deploy redundant HMA instances
- Implement health checks and automatic failover
- Configure graceful degradation (fail-open behavior)

**Risk**: NCMEC API rate limiting  
**Impact**: Reduced detection capability  
**Mitigation**:
- Implement intelligent rate limiting in plugin
- Cache negative results to reduce API calls
- Request rate limit increases from NCMEC

**Risk**: False positive detections  
**Impact**: Legitimate content incorrectly blocked  
**Mitigation**:
- Implement confidence thresholds
- Manual review process for borderline cases
- Feedback loop to improve detection accuracy

### Operational Risks

**Risk**: Inadequate incident response  
**Impact**: Poor handling of CSAM detection events  
**Mitigation**:
- Develop comprehensive incident response procedures
- Train staff on CSAM handling protocols
- Establish clear escalation paths

**Risk**: Compliance violations  
**Impact**: Legal and regulatory consequences  
**Mitigation**:
- Regular compliance audits
- Legal review of procedures
- Staff training on applicable laws and regulations

## Success Criteria

### Technical Success
- [ ] ThreatExchange HMA successfully integrated with NCMEC API
- [ ] Mjolnir HMA Plugin successfully communicating with ThreatExchange HMA
- [ ] End-to-end CSAM detection working in test environment
- [ ] Production deployment with <2 second average response time
- [ ] >99.9% uptime for HMA service

### Operational Success
- [ ] Staff trained on CSAM detection procedures
- [ ] Incident response procedures tested and validated
- [ ] Monitoring and alerting systems operational
- [ ] Compliance documentation complete and reviewed
- [ ] Legal approval for production deployment

### Detection Success
- [ ] Successful detection of known CSAM hashes
- [ ] False positive rate <1% (if measurable)
- [ ] Automatic quarantine functioning correctly
- [ ] Management room alerts working properly
- [ ] Audit logs capturing all detection events

## Timeline Summary

| Phase | Duration | Key Milestones |
|-------|----------|----------------|
| **Phase 1** | Week 1 | NCMEC credentials obtained and tested |
| **Phase 2** | Week 2 | ThreatExchange HMA deployed and configured |
| **Phase 3** | Week 3 | Integration testing completed successfully |
| **Phase 4** | Week 4 | Production deployment with full monitoring |

**Total Timeline**: 4 weeks from start to production deployment

## Next Steps

### Immediate Actions (This Week)
1. **Contact NCMEC** for Hash Sharing API access application
2. **Review ThreatExchange** repository and deployment requirements
3. **Prepare infrastructure** for HMA service deployment
4. **Identify stakeholders** for security and legal review

### Short-term Goals (Next Month)
1. Complete NCMEC credential acquisition
2. Deploy and test ThreatExchange HMA integration
3. Conduct security and compliance review
4. Train operations staff on new procedures

### Long-term Goals (Next Quarter)
1. Monitor and optimize detection performance
2. Integrate additional hash sources beyond NCMEC
3. Implement advanced features (confidence scoring, feedback loops)
4. Expand to video fingerprinting and PDQ perceptual hashing

## Conclusion

The integration of Facebook's ThreatExchange HMA with our Mjolnir HMA Plugin provides a clear path to real CSAM detection using authoritative hash databases. The API compatibility is excellent, requiring no changes to our existing plugin implementation.

With proper NCMEC credentials and ThreatExchange HMA deployment, we can have production-ready CSAM detection operational within 4 weeks. This represents a significant enhancement to Matrix security and protection of vulnerable populations.

The investment in this integration provides immediate security benefits while establishing a foundation for future enhancements in content safety and compliance.

---

**Document Status**: Draft v1.0  
**Last Updated**: December 2024  
**Next Review**: After Phase 1 completion 