/**
 * Deployment State Service
 * 
 * Tracks when purple deployments are in progress to adjust
 * request processing priorities and behavior.
 */

class DeploymentStateService {
  constructor() {
    this.deployments = new Map(); // classId -> deployment info
    this.globalDeploymentCount = 0;
  }

  /**
   * Start tracking a purple deployment
   * @param {string} classId - The class ID being deployed
   * @param {Object} deploymentInfo - Deployment metadata
   */
  startDeployment(classId, deploymentInfo = {}) {
    const deployment = {
      classId,
      startTime: Date.now(),
      status: 'in_progress',
      studentsCount: deploymentInfo.studentsCount || 0,
      questId: deploymentInfo.questId || 'unknown',
      expectedIssues: deploymentInfo.expectedIssues || 0,
      ...deploymentInfo
    };

    this.deployments.set(classId, deployment);
    this.globalDeploymentCount++;

    console.log(`🟣 [DEPLOYMENT-STATE] Started purple deployment for class ${classId}:`);
    console.log(`   Quest: ${deployment.questId}`);
    console.log(`   Students: ${deployment.studentsCount}`);
    console.log(`   Expected issues: ${deployment.expectedIssues}`);
    console.log(`   Active deployments: ${this.globalDeploymentCount}`);

    return deployment;
  }

  /**
   * Update deployment progress
   * @param {string} classId - The class ID
   * @param {Object} updates - Progress updates
   */
  updateDeployment(classId, updates) {
    const deployment = this.deployments.get(classId);
    if (!deployment) {
      console.warn(`⚠️ [DEPLOYMENT-STATE] No deployment found for class ${classId}`);
      return null;
    }

    Object.assign(deployment, updates, {
      lastUpdated: Date.now()
    });

    console.log(`🔄 [DEPLOYMENT-STATE] Updated deployment ${classId}:`, updates);
    return deployment;
  }

  /**
   * Complete a purple deployment
   * @param {string} classId - The class ID
   * @param {Object} results - Final deployment results
   */
  completeDeployment(classId, results = {}) {
    const deployment = this.deployments.get(classId);
    if (!deployment) {
      console.warn(`⚠️ [DEPLOYMENT-STATE] No deployment found for class ${classId}`);
      return null;
    }

    const completedDeployment = {
      ...deployment,
      status: 'completed',
      endTime: Date.now(),
      duration: Date.now() - deployment.startTime,
      results
    };

    this.deployments.set(classId, completedDeployment);
    this.globalDeploymentCount = Math.max(0, this.globalDeploymentCount - 1);

    console.log(`✅ [DEPLOYMENT-STATE] Completed purple deployment for class ${classId}:`);
    console.log(`   Duration: ${completedDeployment.duration}ms`);
    console.log(`   Results:`, results);
    console.log(`   Remaining active deployments: ${this.globalDeploymentCount}`);

    // Clean up completed deployments after 5 minutes
    setTimeout(() => {
      this.deployments.delete(classId);
      console.log(`🧹 [DEPLOYMENT-STATE] Cleaned up deployment record for ${classId}`);
    }, 5 * 60 * 1000);

    return completedDeployment;
  }

  /**
   * Check if any deployments are currently in progress
   * @returns {boolean}
   */
  isAnyDeploymentInProgress() {
    return this.globalDeploymentCount > 0;
  }

  /**
   * Check if a specific class deployment is in progress
   * @param {string} classId - The class ID
   * @returns {boolean}
   */
  isDeploymentInProgress(classId) {
    const deployment = this.deployments.get(classId);
    return deployment && deployment.status === 'in_progress';
  }

  /**
   * Get deployment info for a class
   * @param {string} classId - The class ID
   * @returns {Object|null}
   */
  getDeployment(classId) {
    return this.deployments.get(classId) || null;
  }

  /**
   * Get all active deployments
   * @returns {Array}
   */
  getActiveDeployments() {
    return Array.from(this.deployments.values())
      .filter(deployment => deployment.status === 'in_progress');
  }

  /**
   * Get deployment statistics
   * @returns {Object}
   */
  getStats() {
    const activeDeployments = this.getActiveDeployments();
    const totalDeployments = this.deployments.size;
    
    return {
      activeCount: this.globalDeploymentCount,
      totalTracked: totalDeployments,
      activeDeployments: activeDeployments.map(d => ({
        classId: d.classId,
        questId: d.questId,
        studentsCount: d.studentsCount,
        duration: Date.now() - d.startTime,
        status: d.status
      }))
    };
  }

  /**
   * Emergency function to clear all deployment states
   */
  clearAllDeployments() {
    const count = this.deployments.size;
    this.deployments.clear();
    this.globalDeploymentCount = 0;
    
    console.log(`🧹 [DEPLOYMENT-STATE] Emergency cleared ${count} deployment states`);
    return count;
  }

  /**
   * Auto-detect potential deployment based on request patterns
   * This is a fallback if deployment state isn't properly tracked
   * @param {Object} context - Request context
   * @returns {boolean}
   */
  detectPotentialDeployment(context) {
    // Look for patterns that indicate deployment activity
    const comment = context?.payload?.comment?.body || '';
    const repo = context?.repo()?.repo || '';
    
    // Check for accept commands (common during purple deploy)
    if (comment.trim().toLowerCase().startsWith('/accept q')) {
      console.log(`🔍 [DEPLOYMENT-STATE] Detected potential deployment activity: accept command in ${repo}`);
      return true;
    }

    // Check for multiple rapid requests (deployment pattern)
    const now = Date.now();
    if (!this.recentRequests) {
      this.recentRequests = [];
    }

    // Clean old requests (older than 5 minutes)
    this.recentRequests = this.recentRequests.filter(time => now - time < 5 * 60 * 1000);
    
    // Add current request
    this.recentRequests.push(now);

    // If we have many requests in a short time, likely deployment
    if (this.recentRequests.length > 10) {
      console.log(`🔍 [DEPLOYMENT-STATE] Detected potential deployment activity: ${this.recentRequests.length} requests in 5 minutes`);
      return true;
    }

    return false;
  }
}

// Export singleton instance
const deploymentState = new DeploymentStateService();

export {
  DeploymentStateService,
  deploymentState
};
