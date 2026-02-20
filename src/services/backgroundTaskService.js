/**
 * Background Task Service for OSS-Doorway
 * 
 * Handles bulk operations like issue creation during purple deployments
 * as low-priority background tasks to avoid blocking student validation.
 */

import { priorityQueue } from './priorityQueueService.js';

class BackgroundTaskService {
  constructor() {
    this.taskQueue = [];
    this.processing = false;
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      currentlyProcessing: 0
    };
  }

  /**
   * Queue a bulk issue creation task
   * @param {string} questId - Quest ID (e.g., "Q7")
   * @param {string} taskId - Task ID (e.g., "T1") 
   * @param {string} username - Student username
   * @param {string} repoName - Repository name
   * @param {Object} taskConfig - Task configuration
   * @param {Object} options - Additional options
   */
  queueIssueCreation(questId, taskId, username, repoName, taskConfig, options = {}) {
    return priorityQueue.enqueue('LOW', async () => {
      // Import the issue creation function
      const { createQuestIssue } = await import('../../OSS-Management/backend/controllers/repoController.js');
      
      console.log(`🔧 [BACKGROUND-TASK] Creating issue ${questId}.${taskId} for ${username}`);
      
      try {
        const result = await createQuestIssue(
          questId,
          taskId,
          taskConfig,
          username,
          repoName,
          options.groupId,
          options.className
        );
        
        this.stats.totalProcessed++;
        console.log(`✅ [BACKGROUND-TASK] Created issue ${questId}.${taskId} for ${username}: #${result.issueNumber}`);
        
        return result;
      } catch (error) {
        this.stats.totalFailed++;
        console.error(`❌ [BACKGROUND-TASK] Failed to create issue ${questId}.${taskId} for ${username}:`, error.message);
        throw error;
      }
    }, {
      type: 'bulk_issue_creation',
      user: username,
      repo: repoName,
      quest: questId,
      task: taskId,
      maxRetries: 5 // More retries for background tasks
    });
  }

  /**
   * Queue a batch of issue creations for a quest unlock
   * @param {string} questId - Quest ID
   * @param {string} username - Student username
   * @param {string} repoName - Repository name
   * @param {Object} questConfig - Quest configuration
   * @param {Object} options - Additional options
   */
  async queueQuestUnlock(questId, username, repoName, questConfig, options = {}) {
    const bufferSize = parseInt(process.env.TASK_BUFFER_SIZE) || 1;
    const orderedTasks = Object.keys(questConfig[questId])
      .filter((key) => /^T\d+$/i.test(key))
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    
    const tasksToCreate = Math.min(bufferSize, orderedTasks.length);
    const creationPromises = [];

    console.log(`🚀 [BACKGROUND-TASK] Queueing ${tasksToCreate} issue creations for ${questId} - ${username}`);

    for (let i = 0; i < tasksToCreate; i++) {
      const taskId = orderedTasks[i];
      const taskConfig = questConfig[questId][taskId];
      
      if (taskConfig) {
        const promise = this.queueIssueCreation(
          questId,
          taskId,
          username,
          repoName,
          taskConfig,
          options
        );
        creationPromises.push(promise);
        
        // Add small delay between queuing to spread out the load
        if (i < tasksToCreate - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    return creationPromises;
  }

  /**
   * Queue README updates as background tasks
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} context - GitHub context
   * @param {Object} userData - User data
   * @param {Object} db - Database instance
   */
  queueReadmeUpdate(owner, repo, context, userData, db) {
    return priorityQueue.enqueue('LOW', async () => {
      const { gameFunction } = await import('../gamification.js');
      
      console.log(`📝 [BACKGROUND-TASK] Updating README for ${owner}/${repo}`);
      
      try {
        await gameFunction.updateReadme(owner, repo, context, userData, db);
        console.log(`✅ [BACKGROUND-TASK] README updated for ${owner}/${repo}`);
      } catch (error) {
        console.error(`❌ [BACKGROUND-TASK] README update failed for ${owner}/${repo}:`, error.message);
        throw error;
      }
    }, {
      type: 'readme_update',
      repo: `${owner}/${repo}`,
      user: userData?.github || 'unknown'
    });
  }

  /**
   * Queue cache operations as background tasks
   * @param {string} operation - Operation type ('clear', 'reload', etc.)
   * @param {string} groupId - Group ID for cache operations
   */
  queueCacheOperation(operation, groupId = null) {
    return priorityQueue.enqueue('LOW', async () => {
      const { ConfigService } = await import('./configService.js');
      
      console.log(`🗄️ [BACKGROUND-TASK] Cache operation: ${operation} ${groupId || '(all)'}`);
      
      try {
        switch (operation) {
          case 'clear':
            if (groupId) {
              ConfigService.deleteCacheKey(`quest-config-${groupId}`);
              ConfigService.deleteCacheKey(`processed-quest-config-${groupId}`);
            } else {
              ConfigService.clearCache();
            }
            break;
          case 'reload':
            if (groupId) {
              ConfigService.deleteCacheKey(`quest-config-${groupId}`);
              ConfigService.deleteCacheKey(`processed-quest-config-${groupId}`);
              // Pre-load the config
              await ConfigService.loadConfig(groupId);
            }
            break;
          default:
            throw new Error(`Unknown cache operation: ${operation}`);
        }
        
        console.log(`✅ [BACKGROUND-TASK] Cache operation completed: ${operation}`);
      } catch (error) {
        console.error(`❌ [BACKGROUND-TASK] Cache operation failed:`, error.message);
        throw error;
      }
    }, {
      type: 'cache_operation',
      operation,
      groupId
    });
  }

  /**
   * Get background task statistics
   */
  getStats() {
    const queueStats = priorityQueue.getStats();
    
    return {
      ...this.stats,
      lowPriorityQueueSize: queueStats.queueSizes.LOW,
      totalQueued: queueStats.totals.queued,
      processing: queueStats.processing
    };
  }

  /**
   * Log current background task status
   */
  logStatus() {
    const stats = this.getStats();
    console.log(`🔧 [BACKGROUND-TASK] Status:`);
    console.log(`  Processed: ${stats.totalProcessed}, Failed: ${stats.totalFailed}`);
    console.log(`  Low Priority Queue: ${stats.lowPriorityQueueSize} tasks`);
    console.log(`  Total Queued: ${stats.totalQueued} tasks`);
  }
}

// Export singleton instance
const backgroundTaskService = new BackgroundTaskService();

export {
  BackgroundTaskService,
  backgroundTaskService
};
