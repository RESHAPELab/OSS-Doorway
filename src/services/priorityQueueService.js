/**
 * Priority Queue Service for OSS-Doorway
 * 
 * Handles request prioritization to ensure student validation requests
 * are processed before bulk operations during purple deployments.
 */

class PriorityQueueService {
  constructor() {
    this.queues = {
      HIGH: [], // Student validation requests
      MEDIUM: [], // Normal operations
      LOW: [] // Bulk operations (purple deploy, issue creation)
    };
    
    this.processing = false;
    this.deploymentInProgress = false;
    this.stats = {
      processed: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      queued: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      errors: { HIGH: 0, MEDIUM: 0, LOW: 0 }
    };
    
    // Start processing queue
    this.startProcessing();
  }

  /**
   * Add a request to the priority queue
   * @param {string} priority - HIGH, MEDIUM, or LOW
   * @param {Function} task - The async function to execute
   * @param {Object} context - Request context for logging
   * @returns {Promise} - Resolves when task completes
   */
  enqueue(priority, task, context = {}) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: this.generateId(),
        priority,
        task,
        context,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        retries: 0,
        maxRetries: context.maxRetries || 3
      };

      this.queues[priority].push(queueItem);
      this.stats.queued[priority]++;
      
      console.log(`🔄 [PRIORITY-QUEUE] Enqueued ${priority} priority task: ${context.type || 'unknown'} (queue size: ${this.queues[priority].length})`);
      
      // If it's a high priority task and deployment is in progress, log it
      if (priority === 'HIGH' && this.deploymentInProgress) {
        console.log(`🚨 [PRIORITY-QUEUE] HIGH priority task during deployment: ${context.type} for ${context.user || 'unknown'}`);
      }
    });
  }

  /**
   * Mark deployment as in progress to adjust processing behavior
   */
  setDeploymentInProgress(inProgress) {
    this.deploymentInProgress = inProgress;
    console.log(`🟣 [PRIORITY-QUEUE] Deployment status: ${inProgress ? 'IN PROGRESS' : 'COMPLETED'}`);
    
    if (inProgress) {
      // During deployment, process HIGH priority more aggressively
      console.log(`🚨 [PRIORITY-QUEUE] Prioritizing student validation requests during deployment`);
    }
  }

  /**
   * Get next task to process based on priority and deployment status
   */
  getNextTask() {
    // Always process HIGH priority first
    if (this.queues.HIGH.length > 0) {
      return this.queues.HIGH.shift();
    }

    // During deployment, heavily favor HIGH priority and limit LOW priority
    if (this.deploymentInProgress) {
      // Only process LOW priority if no HIGH or MEDIUM tasks are waiting
      if (this.queues.MEDIUM.length > 0) {
        return this.queues.MEDIUM.shift();
      }
      
      // Process LOW priority sparingly during deployment (1 in 5 cycles)
      if (this.queues.LOW.length > 0 && Math.random() < 0.2) {
        return this.queues.LOW.shift();
      }
    } else {
      // Normal processing - round robin between MEDIUM and LOW
      if (this.queues.MEDIUM.length > 0) {
        return this.queues.MEDIUM.shift();
      }
      
      if (this.queues.LOW.length > 0) {
        return this.queues.LOW.shift();
      }
    }

    return null;
  }

  /**
   * Start the queue processing loop
   */
  async startProcessing() {
    if (this.processing) return;
    
    this.processing = true;
    console.log(`🚀 [PRIORITY-QUEUE] Started processing queue`);

    while (this.processing) {
      try {
        const task = this.getNextTask();
        
        if (!task) {
          // No tasks to process, wait a bit
          await this.sleep(100);
          continue;
        }

        const startTime = Date.now();
        const waitTime = startTime - task.enqueuedAt;
        
        console.log(`⚡ [PRIORITY-QUEUE] Processing ${task.priority} task ${task.id} (waited ${waitTime}ms): ${task.context.type || 'unknown'}`);

        try {
          // Execute the task
          const result = await task.task();
          const processingTime = Date.now() - startTime;
          
          // Update stats
          this.stats.processed[task.priority]++;
          this.stats.queued[task.priority]--;
          
          console.log(`✅ [PRIORITY-QUEUE] Completed ${task.priority} task ${task.id} in ${processingTime}ms`);
          task.resolve(result);
          
        } catch (error) {
          const processingTime = Date.now() - startTime;
          
          // Handle retries
          if (task.retries < task.maxRetries) {
            task.retries++;
            console.log(`🔄 [PRIORITY-QUEUE] Retrying ${task.priority} task ${task.id} (attempt ${task.retries}/${task.maxRetries}): ${error.message}`);
            
            // Re-queue with exponential backoff
            await this.sleep(Math.pow(2, task.retries) * 1000);
            this.queues[task.priority].unshift(task); // Add to front for retry
            continue;
          }
          
          // Max retries reached
          this.stats.errors[task.priority]++;
          this.stats.queued[task.priority]--;
          
          console.error(`❌ [PRIORITY-QUEUE] Failed ${task.priority} task ${task.id} after ${task.maxRetries} retries in ${processingTime}ms:`, error.message);
          task.reject(error);
        }

        // Add small delay between tasks to prevent overwhelming
        const delay = this.getProcessingDelay(task.priority);
        if (delay > 0) {
          await this.sleep(delay);
        }

      } catch (error) {
        console.error(`💥 [PRIORITY-QUEUE] Queue processing error:`, error);
        await this.sleep(1000); // Wait before retrying
      }
    }
  }

  /**
   * Get processing delay based on priority and deployment status
   */
  getProcessingDelay(priority) {
    if (this.deploymentInProgress) {
      // During deployment, minimize delays for HIGH priority
      switch (priority) {
        case 'HIGH': return 50;   // Minimal delay for student validation
        case 'MEDIUM': return 200;
        case 'LOW': return 1000;  // Longer delay for bulk operations
      }
    } else {
      // Normal processing delays
      switch (priority) {
        case 'HIGH': return 100;
        case 'MEDIUM': return 200;
        case 'LOW': return 500;
      }
    }
    return 200;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const totalQueued = Object.values(this.stats.queued).reduce((sum, count) => sum + count, 0);
    const totalProcessed = Object.values(this.stats.processed).reduce((sum, count) => sum + count, 0);
    const totalErrors = Object.values(this.stats.errors).reduce((sum, count) => sum + count, 0);

    return {
      ...this.stats,
      totals: {
        queued: totalQueued,
        processed: totalProcessed,
        errors: totalErrors
      },
      queueSizes: {
        HIGH: this.queues.HIGH.length,
        MEDIUM: this.queues.MEDIUM.length,
        LOW: this.queues.LOW.length
      },
      deploymentInProgress: this.deploymentInProgress,
      processing: this.processing
    };
  }

  /**
   * Log current queue status
   */
  logStatus() {
    const stats = this.getStats();
    console.log(`📊 [PRIORITY-QUEUE] Status:`);
    console.log(`  Queue Sizes: HIGH=${stats.queueSizes.HIGH}, MEDIUM=${stats.queueSizes.MEDIUM}, LOW=${stats.queueSizes.LOW}`);
    console.log(`  Processed: HIGH=${stats.processed.HIGH}, MEDIUM=${stats.processed.MEDIUM}, LOW=${stats.processed.LOW}`);
    console.log(`  Errors: HIGH=${stats.errors.HIGH}, MEDIUM=${stats.errors.MEDIUM}, LOW=${stats.errors.LOW}`);
    console.log(`  Deployment: ${stats.deploymentInProgress ? 'IN PROGRESS' : 'IDLE'}`);
  }

  /**
   * Clear all queues (emergency use)
   */
  clearQueues() {
    const totalCleared = this.queues.HIGH.length + this.queues.MEDIUM.length + this.queues.LOW.length;
    
    // Reject all pending tasks
    Object.values(this.queues).forEach(queue => {
      queue.forEach(task => {
        task.reject(new Error('Queue cleared'));
      });
    });

    this.queues = { HIGH: [], MEDIUM: [], LOW: [] };
    this.stats.queued = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    
    console.log(`🧹 [PRIORITY-QUEUE] Cleared ${totalCleared} queued tasks`);
    return totalCleared;
  }

  /**
   * Stop queue processing
   */
  stop() {
    this.processing = false;
    console.log(`🛑 [PRIORITY-QUEUE] Stopped processing`);
  }

  /**
   * Utility functions
   */
  generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
const priorityQueueService = new PriorityQueueService();

export {
  PriorityQueueService,
  priorityQueueService as priorityQueue
};
