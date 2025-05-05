import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { SecurityService } from '@security/security.service';

@Controller('api/security')
export class SecurityController {
  private readonly logger = new Logger(SecurityController.name);

  constructor(private readonly securityService: SecurityService) {}

  @Get('status')
  getSecurityStatus() {
    return this.securityService.getSecurityStatus();
  }

  @Post('scan')
  async triggerSecurityScan(@Body() options: any) {
    this.logger.log(`Triggering security scan with options: ${JSON.stringify(options)}`);
    await this.securityService.runScheduledSecurityScan();
    return { success: true, message: 'Security scan triggered successfully' };
  }

  @Get('current-scan')
  async getCurrentScanInfo() {
    return this.securityService.getSecurityStatus();
  }

  @Get('vulnerabilities')
  async getVulnerabilities(@Query('severity') severity?: string, @Query('type') type?: string) {
    return this.securityService.getVulnerabilities({ severity, type });
  }

  @Post('scan/network')
  async scanNetwork(@Body() options: any) {
    this.logger.log(`Triggering network-only scan with options: ${JSON.stringify(options)}`);
    const results = await this.securityService.runNetworkScan(options);
    return { success: true, vulnerabilities: results.length, results };
  }

  @Post('scan/config')
  async auditConfig(@Body() options: any) {
    this.logger.log(`Triggering config audit with options: ${JSON.stringify(options)}`);
    const results = await this.securityService.runConfigAudit(options);
    return { success: true, findings: results.length, results };
  }
  
  @Get('chains')
  async getAvailableChains() {
    return { 
      chains: this.securityService.getAvailableChains(),
      message: 'Use POST /api/security/scan/chain/:chainName to scan a specific chain'
    };
  }
  
  @Post('scan/chain/:chainName')
  async scanSpecificChain(@Param('chainName') chainName: string) {
    this.logger.log(`Triggering chain-specific scan for: ${chainName}`);
    try {
      const results = await this.securityService.scanSpecificChain(chainName);
      return { 
        success: true, 
        chain: chainName,
        vulnerabilities: results.length, 
        results 
      };
    } catch (error) {
      return { 
        success: false, 
        chain: chainName,
        error: error.message 
      };
    }
  }
}
