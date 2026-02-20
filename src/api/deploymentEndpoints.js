/**
 * Deployment API Endpoints for OSS-Doorway
 * 
 * Handles deployment state notifications from OSS-Management
 */

import { deploymentState } from '../services/deploymentStateService.js';
import { priorityQueue } from '../services/priorityQueueService.js';

/**
 * Start deployment tracking
 * POST /api/deployment/start
 */
export const startDeployment = async (req, res) => {
  try {
    const { classId, questId, studentsCount, expectedIssues } = req.body;
    
    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const deployment = deploymentState.startDeployment(classId, {
      questId: questId || 'unknown',
      studentsCount: studentsCount || 0,
      expectedIssues: expectedIssues || 0
    });

    // Update priority queue to deployment mode
    priorityQueue.setDeploymentInProgress(true);

    console.log(`🟣 [DEPLOYMENT-API] Started tracking deployment for class ${classId}`);

    res.json({
      success: true,
      message: 'Deployment tracking started',
      deployment
    });
  } catch (error) {
    console.error('❌ [DEPLOYMENT-API] Error starting deployment tracking:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update deployment progress
 * POST /api/deployment/update
 */
export const updateDeployment = async (req, res) => {
  try {
    const { classId, ...updates } = req.body;
    
    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const deployment = deploymentState.updateDeployment(classId, updates);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    console.log(`🔄 [DEPLOYMENT-API] Updated deployment for class ${classId}`);

    res.json({
      success: true,
      message: 'Deployment updated',
      deployment
    });
  } catch (error) {
    console.error('❌ [DEPLOYMENT-API] Error updating deployment:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Complete deployment tracking
 * POST /api/deployment/complete
 */
export const completeDeployment = async (req, res) => {
  try {
    const { classId, results } = req.body;
    
    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const deployment = deploymentState.completeDeployment(classId, results || {});
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    // Check if any other deployments are still active
    const stillActive = deploymentState.isAnyDeploymentInProgress();
    if (!stillActive) {
      priorityQueue.setDeploymentInProgress(false);
      console.log(`🟢 [DEPLOYMENT-API] All deployments complete, returning to normal priority mode`);
    }

    console.log(`✅ [DEPLOYMENT-API] Completed deployment for class ${classId}`);

    res.json({
      success: true,
      message: 'Deployment completed',
      deployment,
      allDeploymentsComplete: !stillActive
    });
  } catch (error) {
    console.error('❌ [DEPLOYMENT-API] Error completing deployment:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get deployment status
 * GET /api/deployment/status
 */
export const getDeploymentStatus = async (req, res) => {
  try {
    const { classId } = req.query;
    
    if (classId) {
      // Get specific deployment
      const deployment = deploymentState.getDeployment(classId);
      if (!deployment) {
        return res.status(404).json({ error: 'Deployment not found' });
      }
      
      res.json({
        success: true,
        deployment
      });
    } else {
      // Get all deployment stats
      const stats = deploymentState.getStats();
      const queueStats = priorityQueue.getStats();
      
      res.json({
        success: true,
        deploymentStats: stats,
        queueStats
      });
    }
  } catch (error) {
    console.error('❌ [DEPLOYMENT-API] Error getting deployment status:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Emergency clear all deployments
 * POST /api/deployment/clear
 */
export const clearAllDeployments = async (req, res) => {
  try {
    const clearedCount = deploymentState.clearAllDeployments();
    priorityQueue.setDeploymentInProgress(false);
    
    console.log(`🧹 [DEPLOYMENT-API] Emergency cleared ${clearedCount} deployments`);

    res.json({
      success: true,
      message: `Cleared ${clearedCount} deployments`,
      clearedCount
    });
  } catch (error) {
    console.error('❌ [DEPLOYMENT-API] Error clearing deployments:', error);
    res.status(500).json({ error: error.message });
  }
};
