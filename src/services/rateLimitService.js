/**
 * Rate Limiting Service for GitHub API Calls
 * 
 * Implements intelligent rate limiting during purple deployments
 * to prevent API exhaustion while prioritizing student validation.
 */

class RateLimitService {
  constructor() {
    this.apiCalls = new Map(); // endpoint -> call history
    this.deploymentMode = false;
    this.limits = {
      normal: {
        issuesCreate: { calls: 30, window: 60000 }, // 30 calls per minute
        issuesGet: { calls: 60, window: 60000 },    // 60 calls per minute
        issuesComment: { calls: 40, window: 60000 }  // 40 calls per minute
      },
      deployment: {
        issuesCreate: { calls: 15, window: 60000 }, // 15 calls per minute during deployment
        issuesGet: { calls: 30, window: 60000 },    // 30 calls per minute during deployment
        issuesComment: { calls: 60, window: 60000 }  // Keep comment rate high for student responses
      }
    };
  }

  /**
   * Set deployment mode to adjust rate limits
   * @param {boolean} inDeployment - Whether deployment is in progress
   */
  setDeploymentMode(inDeployment) {
    this.deploymentMode = inDeployment;
    console.log(`⚡ [RATE-LIMIT] ${inDeployment ? 'DEPLOYMENT' : 'NORMAL'} mode activated`);
  }

  /**
   * Check if an API call is allowed under current rate limits
   * @param {string} endpoint - API endpoint (e.g., 'issuesCreate', 'issuesComment')
   * @param {string} priority - Request priority (HIGH, MEDIUM, LOW)
   * @returns {Object} - { allowed: boolean, waitTime: number, reason: string }
   */
  checkRateLimit(endpoint, priority = 'MEDIUM') {
    const now = Date.now();
    const limits = this.deploymentMode ? this.limits.deployment : this.limits.normal;
    const limit = limits[endpoint];

    if (!limit) {
      // No specific limit for this endpoint, allow it
      return { allowed: true, waitTime: 0, reason: 'no_limit' };
    }

    // Get call history for this endpoint
    if (!this.apiCalls.has(endpoint)) {
      this.apiCalls.set(endpoint, []);
    }

    const callHistory = this.apiCalls.get(endpoint);
    
    // Remove calls outside the time window
    const windowStart = now - limit.window;
    const recentCalls = callHistory.filter(callTime => callTime > windowStart);
    this.apiCalls.set(endpoint, recentCalls);

    // Check if we're within limits
    if (recentCalls.length < limit.calls) {
      return { allowed: true, waitTime: 0, reason: 'within_limit' };
    }

    // Rate limit exceeded - calculate wait time
    const oldestCall = Math.min(...recentCalls);
    const waitTime = (oldestCall + limit.window) - now;

    // During deployment, prioritize HIGH priority requests
    if (this.deploymentMode && priority === 'HIGH') {
      // Allow HIGH priority to exceed limits by 50% during deployment
      const extendedLimit = Math.floor(limit.calls * 1.5);
      if (recentCalls.length < extendedLimit) {
        console.log(`🚨 [RATE-LIMIT] Allowing HIGH priority request to exceed normal limit (${recentCalls.length}/${extendedLimit})`);
        return { allowed: true, waitTime: 0, reason: 'high_priority_override' };
      }
    }

    return { 
      allowed: false, 
      waitTime: Math.max(0, waitTime),
      reason: 'rate_limited',
      currentCalls: recentCalls.length,
      maxCalls: limit.calls
    };
  }

  /**
   * Record an API call for rate limiting
   * @param {string} endpoint - API endpoint
   * @param {number} timestamp - Call timestamp (defaults to now)
   */
  recordApiCall(endpoint, timestamp = Date.now()) {
    if (!this.apiCalls.has(endpoint)) {
      this.apiCalls.set(endpoint, []);
    }

    const callHistory = this.apiCalls.get(endpoint);
    callHistory.push(timestamp);

    // Keep only recent calls to prevent memory bloat
    const windowStart = timestamp - Math.max(
      this.limits.normal[endpoint]?.window || 60000,
      this.limits.deployment[endpoint]?.window || 60000
    );
    const recentCalls = callHistory.filter(callTime => callTime > windowStart);
    this.apiCalls.set(endpoint, recentCalls);

    console.log(`📊 [RATE-LIMIT] Recorded ${endpoint} call (${recentCalls.length} recent calls)`);
  }

  /**
   * Wait for rate limit to clear if needed
   * @param {string} endpoint - API endpoint
   * @param {string} priority - Request priority
   * @returns {Promise} - Resolves when call is allowed
   */
  async waitForRateLimit(endpoint, priority = 'MEDIUM') {
    const check = this.checkRateLimit(endpoint, priority);
    
    if (check.allowed) {
      return check;
    }

    if (check.waitTime > 0) {
      console.log(`⏳ [RATE-LIMIT] Rate limited for ${endpoint} (${priority}), waiting ${check.waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, check.waitTime));
    }

    // Check again after waiting
    return this.checkRateLimit(endpoint, priority);
  }

  /**
   * Wrap a GitHub API call with rate limiting
   * @param {string} endpoint - API endpoint
   * @param {Function} apiCall - The API call function
   * @param {string} priority - Request priority
   * @returns {Promise} - API call result
   */
  async rateLimitedCall(endpoint, apiCall, priority = 'MEDIUM') {
    // Wait for rate limit if needed
    await this.waitForRateLimit(endpoint, priority);
    
    // Record the call
    this.recordApiCall(endpoint);
    
    try {
      const result = await apiCall();
      return result;
    } catch (error) {
      // Handle GitHub rate limit errors
      if (error.status === 403 && error.message?.includes('rate limit')) {
        console.error(`🚫 [RATE-LIMIT] GitHub rate limit exceeded for ${endpoint}`);
        
        // Extract reset time from GitHub headers if available
        const resetTime = error.response?.headers?.['x-ratelimit-reset'];
        if (resetTime) {
          const waitTime = (parseInt(resetTime) * 1000) - Date.now();
          if (waitTime > 0) {
            console.log(`⏳ [RATE-LIMIT] Waiting for GitHub rate limit reset: ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Retry the call
            this.recordApiCall(endpoint);
            return await apiCall();
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * Get rate limiting statistics
   * @returns {Object} - Current rate limit status
   */
  getStats() {
    const now = Date.now();
    const stats = {
      deploymentMode: this.deploymentMode,
      endpoints: {}
    };

    for (const [endpoint, callHistory] of this.apiCalls.entries()) {
      const limits = this.deploymentMode ? this.limits.deployment : this.limits.normal;
      const limit = limits[endpoint];
      
      if (limit) {
        const windowStart = now - limit.window;
        const recentCalls = callHistory.filter(callTime => callTime > windowStart);
        
        stats.endpoints[endpoint] = {
          recentCalls: recentCalls.length,
          maxCalls: limit.calls,
          windowMs: limit.window,
          utilizationPercent: Math.round((recentCalls.length / limit.calls) * 100)
        };
      }
    }

    return stats;
  }

  /**
   * Log current rate limit status
   */
  logStatus() {
    const stats = this.getStats();
    console.log(`⚡ [RATE-LIMIT] Status (${stats.deploymentMode ? 'DEPLOYMENT' : 'NORMAL'} mode):`);
    
    for (const [endpoint, data] of Object.entries(stats.endpoints)) {
      console.log(`  ${endpoint}: ${data.recentCalls}/${data.maxCalls} (${data.utilizationPercent}%)`);
    }
  }

  /**
   * Clear all rate limit history (emergency use)
   */
  clearHistory() {
    const totalCalls = Array.from(this.apiCalls.values()).reduce((sum, calls) => sum + calls.length, 0);
    this.apiCalls.clear();
    
    console.log(`🧹 [RATE-LIMIT] Cleared ${totalCalls} API call records`);
    return totalCalls;
  }
}

// Export singleton instance
const rateLimitService = new RateLimitService();

export {
  RateLimitService,
  rateLimitService
};
