import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Extract image URLs from GitHub comment body
 * Supports both markdown format ![alt](url) and HTML <img> tags
 */
const extractImageUrls = (commentBody) => {
  const urls = [];
  
  // Markdown format: ![alt](url)
  const markdownRegex = /!\[.*?\]\((.*?)\)/g;
  let match;
  while ((match = markdownRegex.exec(commentBody)) !== null) {
    urls.push(match[1]);
  }
  
  // HTML format: <img src="url">
  const htmlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
  while ((match = htmlRegex.exec(commentBody)) !== null) {
    urls.push(match[1]);
  }
  
  return urls;
};

/**
 * Validate image URL accessibility and format
 */
const validateImageUrl = async (imageUrl) => {
  try {
    // Basic URL validation
    new URL(imageUrl);
    
    // Security check - only allow trusted domains
    const url = new URL(imageUrl);
    const allowedDomains = [
      'github.com',
      'user-images.githubusercontent.com',
      'githubusercontent.com',
      'raw.githubusercontent.com'
    ];
    
    if (!allowedDomains.some(domain => url.hostname.includes(domain))) {
      throw new Error('Untrusted image source. Please use GitHub-hosted images.');
    }
    
    // Check if URL is accessible
    const response = await fetch(imageUrl, { 
      method: 'HEAD',
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Image not found. Please check the image link.');
      } else if (response.status === 403) {
        throw new Error('Image access denied. Please ensure the image is publicly accessible.');
      } else {
        throw new Error(`Image not accessible (HTTP ${response.status})`);
      }
    }
    
    // Check content type
    const contentType = response.headers.get('content-type');
    const supportedFormats = [
      'image/jpeg', 'image/jpg', 'image/png', 
      'image/gif', 'image/webp'
    ];
    
    if (!contentType || !supportedFormats.some(format => contentType.includes(format))) {
      throw new Error(`Unsupported image format. Please use: ${supportedFormats.join(', ')}`);
    }
    
    // Check file size
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeMB = parseInt(contentLength) / (1024 * 1024);
      if (sizeMB > 10) {
        throw new Error(`Image too large (${sizeMB.toFixed(1)}MB). Please compress to under 10MB.`);
      }
      
      if (sizeMB > 5) {
        console.log(`⚠️ [IMAGE_VALIDATION] Large image detected: ${sizeMB.toFixed(1)}MB`);
      }
    }
    
    return { valid: true, contentType, size: contentLength };
    
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

/**
 * Process GitHub-specific image URLs
 */
const processGitHubImageUrl = (imageUrl) => {
  // Convert blob URLs to raw URLs
  if (imageUrl.includes('github.com') && imageUrl.includes('/blob/')) {
    return imageUrl.replace('/blob/', '/raw/');
  }
  
  // Return as-is for user-attachments and other valid URLs
  return imageUrl;
};

/**
 * Compress image before sending to OpenAI API
 */
const compressImageForAPI = async (imageUrl, taskConfig = {}) => {
  try {
    console.log(`🗜️ [IMAGE_VALIDATION] Checking image size for compression...`);
    
    // First check the image size
    const headResponse = await fetch(imageUrl, { method: 'HEAD' });
    const contentLength = headResponse.headers.get('content-length');
    
    if (!contentLength) {
      console.log(`⚠️ [IMAGE_VALIDATION] Cannot determine image size, using original`);
      return imageUrl;
    }
    
    const sizeMB = parseInt(contentLength) / (1024 * 1024);
    console.log(`📏 [IMAGE_VALIDATION] Original image size: ${sizeMB.toFixed(1)}MB`);
    
    // If image is already small enough, return original
    const maxSizeMB = taskConfig.maxImageSizeMB || 5;
    if (sizeMB <= maxSizeMB) {
      console.log(`✅ [IMAGE_VALIDATION] Image size acceptable (${sizeMB.toFixed(1)}MB ≤ ${maxSizeMB}MB), no compression needed`);
      return imageUrl;
    }
    
    console.log(`🗜️ [IMAGE_VALIDATION] Compressing large image (${sizeMB.toFixed(1)}MB)...`);
    
    // Download the image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    
    // Create a canvas to compress the image
    const canvas = new OffscreenCanvas(1024, 1024);
    const ctx = canvas.getContext('2d');
    
    // Load image into canvas
    const blob = new Blob([imageBuffer]);
    const imageBitmap = await createImageBitmap(blob);
    
    // Calculate new dimensions (maintain aspect ratio, use configured max size)
    const maxSize = taskConfig.maxDimensions || 1024;
    let { width, height } = imageBitmap;
    
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }
    
    canvas.width = width;
    canvas.height = height;
    
    // Draw compressed image
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    
    // Convert to blob with compression
    const compressionQuality = taskConfig.compressionQuality || 0.8;
    const compressedBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: compressionQuality
    });
    
    // Convert to base64 data URL
    const arrayBuffer = await compressedBlob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const compressedUrl = `data:image/jpeg;base64,${base64}`;
    
    const compressedSizeMB = compressedBlob.size / (1024 * 1024);
    console.log(`✅ [IMAGE_VALIDATION] Compression complete: ${sizeMB.toFixed(1)}MB → ${compressedSizeMB.toFixed(1)}MB (${((1 - compressedBlob.size / imageBuffer.byteLength) * 100).toFixed(0)}% reduction)`);
    
    return compressedUrl;
    
  } catch (error) {
    console.error(`❌ [IMAGE_VALIDATION] Compression failed:`, error.message);
    console.log(`🔄 [IMAGE_VALIDATION] Falling back to original image`);
    return imageUrl; // Fallback to original if compression fails
  }
};

/**
 * Calculate optimal max_tokens based on image size and task complexity
 */
const calculateOptimalMaxTokens = (imageUrl, validationCriteria, taskConfig = {}) => {
  // Base tokens for the image (estimate)
  let estimatedImageTokens = 500; // Conservative estimate
  
  // Try to get more accurate estimate from image dimensions
  if (imageUrl.includes('data:image')) {
    // For base64 images, we can estimate better
    estimatedImageTokens = 800; // Compressed images are typically smaller
  } else if (imageUrl.includes('github.com')) {
    // GitHub images are often screenshots/diagrams
    estimatedImageTokens = 600;
  }
  
  // Calculate prompt complexity
  const promptTokens = Math.ceil(validationCriteria.length / 4);
  
  // Calculate optimal response tokens
  const maxAllowedTokens = 4000; // OpenAI's limit
  const reservedTokens = estimatedImageTokens + promptTokens + 100; // Buffer
  const optimalTokens = Math.min(taskConfig.maxTokens || 1000, maxAllowedTokens - reservedTokens);
  
  // Ensure minimum viable response
  const finalTokens = Math.max(500, optimalTokens);
  
  console.log(`🎯 [IMAGE_VALIDATION] Token calculation: Image~${estimatedImageTokens}, Prompt~${promptTokens}, Response:${finalTokens}, Total~${estimatedImageTokens + promptTokens + finalTokens}`);
  
  return finalTokens;
};

/**
 * Validate image content using OpenAI Vision API with compression and optimized tokens
 */
const validateImageWithOpenAI = async (imageUrl, validationCriteria, taskConfig = {}) => {
  try {
    const { temperature = 0.1 } = taskConfig;
    
    console.log(`🔍 [IMAGE_VALIDATION] Starting AI analysis...`);
    
    // Compress image if needed
    const processedImageUrl = await compressImageForAPI(imageUrl, taskConfig);
    
    // Calculate optimal token allocation
    const optimalMaxTokens = calculateOptimalMaxTokens(processedImageUrl, validationCriteria, taskConfig);
    
    console.log(`🧠 [IMAGE_VALIDATION] Sending to OpenAI with ${optimalMaxTokens} max tokens`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this image and determine if it meets these criteria: ${validationCriteria}

Please provide a detailed analysis including:
1. What type of diagram or image this is
2. Whether it meets the criteria (YES or NO)
3. Specific details about what you observe
4. Any relevant elements that support your conclusion

Respond with a clear YES or NO at the beginning, followed by your detailed analysis.`
            },
            {
              type: "image_url",
              image_url: {
                url: processedImageUrl
              }
            }
          ]
        }
      ],
      max_tokens: optimalMaxTokens,
      temperature: temperature
    });
    
    const analysis = response.choices[0].message.content;
    const tokensUsed = response.usage?.total_tokens || 0;
    
    console.log(`📝 [IMAGE_VALIDATION] Analysis complete - Used ${tokensUsed} tokens`);
    
    // Parse the response to determine if it meets criteria
    const analysisLower = analysis.toLowerCase();
    const startsWithYes = analysisLower.trim().startsWith('yes');
    const containsPositiveKeywords = analysisLower.includes('meets') || 
                                   analysisLower.includes('correct') || 
                                   analysisLower.includes('valid');
    
    const meetsCriteria = startsWithYes && containsPositiveKeywords;
    
    return {
      meetsCriteria,
      analysis,
      imageUrl: processedImageUrl,
      tokensUsed,
      originalImageUrl: imageUrl,
      compressionApplied: processedImageUrl !== imageUrl
    };
    
  } catch (error) {
    console.error(`❌ [IMAGE_VALIDATION] OpenAI API error:`, error.message);
    
    if (error.message.includes('rate_limit')) {
      throw new Error('API rate limit reached. Please try again in a few moments.');
    } else if (error.message.includes('timeout')) {
      throw new Error('Image analysis timed out. Please try with a smaller image.');
    } else {
      throw new Error(`Image analysis failed: ${error.message}`);
    }
  }
};

/**
 * Main image validation handler
 * Integrates with the existing bot architecture
 */
const handleImageValidation = async (user, ossRepo, quest, task, userData, context, db) => {
  console.log(`🚀 [IMAGE_VALIDATION] Starting validation for ${user} in ${ossRepo}`);
  
  try {
    // Extract validation criteria from task configuration
    const validationCriteria = task.imageValidation?.validationCriteria || 
                              task.validationCriteria || 
                              "Analyze this image and determine if it meets the specified requirements.";
    
    const taskConfig = {
      temperature: task.imageValidation?.temperature || 0.1,
      maxTokens: task.imageValidation?.maxTokens || 1000
    };
    
    // Extract image URLs from the comment
    const imageUrls = extractImageUrls(context.commentBody || context.body || '');
    
    if (imageUrls.length === 0) {
      return {
        success: false,
        message: task.error || "❌ **No Image Found**\\n\\nPlease include an image in your comment using:\\n- Markdown: `![description](image-url)`\\n- HTML: `<img src=\"image-url\">`\\n\\n**Note:** Make sure your image is publicly accessible."
      };
    }
    
    console.log(`📸 [IMAGE_VALIDATION] Found ${imageUrls.length} image(s) to validate`);
    
    const results = [];
    let totalTokensUsed = 0;
    
    // Process each image
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      console.log(`🔍 [IMAGE_VALIDATION] Processing image ${i + 1}/${imageUrls.length}`);
      
      try {
        // Process GitHub-specific URLs
        const processedUrl = processGitHubImageUrl(imageUrl);
        
        // Validate URL accessibility and format
        const urlValidation = await validateImageUrl(processedUrl);
        if (!urlValidation.valid) {
          results.push({
            imageUrl: processedUrl,
            validation: `Error: ${urlValidation.error}`,
            meetsCriteria: false,
            error: urlValidation.error
          });
          continue;
        }
        
        // Validate with OpenAI
        const aiValidation = await validateImageWithOpenAI(processedUrl, validationCriteria, taskConfig);
        totalTokensUsed += aiValidation.tokensUsed;
        
        results.push({
          imageUrl: processedUrl,
          validation: aiValidation.analysis,
          meetsCriteria: aiValidation.meetsCriteria,
          tokensUsed: aiValidation.tokensUsed
        });
        
      } catch (error) {
        console.error(`❌ [IMAGE_VALIDATION] Error processing image ${i + 1}:`, error.message);
        results.push({
          imageUrl,
          validation: `Error: ${error.message}`,
          meetsCriteria: false,
          error: error.message
        });
      }
    }
    
    // Determine overall success
    const validResults = results.filter(r => r.meetsCriteria);
    const allValid = validResults.length > 0 && validResults.length === results.length;
    
    // Log cost tracking and compression stats
    const compressionStats = results.filter(r => r.compressionApplied).length;
    const avgTokensPerImage = totalTokensUsed / results.length;
    const estimatedCost = (totalTokensUsed * 0.0000025).toFixed(4); // GPT-4o input pricing
    
    console.log(`💰 [IMAGE_VALIDATION] Cost Summary:`);
    console.log(`   📊 Total tokens used: ${totalTokensUsed}`);
    console.log(`   💵 Estimated cost: $${estimatedCost}`);
    console.log(`   🗜️ Images compressed: ${compressionStats}/${results.length}`);
    console.log(`   📈 Avg tokens per image: ${avgTokensPerImage.toFixed(0)}`);
    
    // Prepare response message
    let responseMessage;
    if (allValid) {
      responseMessage = task.success || "✅ **Image Validation Successful!**\\n\\nYour image(s) meet the specified criteria.";
    } else {
      const errorMessages = results
        .filter(r => !r.meetsCriteria)
        .map(r => r.error || 'Does not meet validation criteria')
        .join('\\n- ');
      
      responseMessage = task.error || 
        `❌ **Image Validation Failed**\\n\\nIssues found:\\n- ${errorMessages}\\n\\nPlease review the criteria and submit a corrected image.`;
    }
    
    // Save validation data if configured
    if (task.saveValidatedData && task.savedDataName) {
      const validationData = {
        timestamp: new Date().toISOString(),
        imageUrls: results.map(r => r.imageUrl),
        validationResults: results,
        totalTokensUsed,
        allValid
      };
      
      // Save to user data (implementation depends on your data storage system)
      console.log(`💾 [IMAGE_VALIDATION] Saving validation data as: ${task.savedDataName}`);
      // await saveUserValidationData(user, task.savedDataName, validationData);
    }
    
    return {
      success: allValid,
      message: responseMessage,
      details: {
        imagesProcessed: results.length,
        validImages: validResults.length,
        totalTokensUsed,
        results
      }
    };
    
  } catch (error) {
    console.error(`❌ [IMAGE_VALIDATION] Handler error:`, error.message);
    return {
      success: false,
      message: task.error || `❌ **Validation Error**\\n\\nSomething went wrong during image validation: ${error.message}\\n\\nPlease try again or contact support.`,
      error: error.message
    };
  }
};

export {
  handleImageValidation,
  extractImageUrls,
  validateImageUrl,
  validateImageWithOpenAI,
  processGitHubImageUrl,
  compressImageForAPI,
  calculateOptimalMaxTokens
};
