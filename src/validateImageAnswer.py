#!/usr/bin/env python3
import sys
import os
import base64
import tempfile
import requests
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image
import io

load_dotenv()

def compress_image(image_path, max_size=(800, 600), quality=80):
    """Compress image to reduce file size for API rate limits"""
    try:
        with Image.open(image_path) as img:
            # Convert to RGB if necessary (for PNG with transparency)
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            
            # Resize image while maintaining aspect ratio
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Save compressed image
            compressed_path = image_path.replace('.png', '_compressed.jpg').replace('.jpg', '_compressed.jpg')
            img.save(compressed_path, 'JPEG', quality=quality, optimize=True)
            
            return compressed_path
    except Exception as e:
        print(f"Warning: Image compression failed: {e}", file=sys.stderr)
        return image_path  # Return original if compression fails

def download_image(image_url, temp_file_path, github_token=None):
    """Download image from URL with optional GitHub authentication"""
    try:
        headers = {
            'User-Agent': 'OSS-Management-ImageValidation/1.0'
        }
        
        if github_token:
            headers['Authorization'] = f'token {github_token}'
        
        response = requests.get(image_url, headers=headers, stream=True, timeout=30)
        response.raise_for_status()
        
        with open(temp_file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return True
    except Exception as e:
        print(f"Error downloading image: {e}", file=sys.stderr)
        return False

def validate_image_answer(validation_prompt: str, image_url: str, enable_detailed: bool, temperature: float, github_token: str = None):
    temp_files = []
    try:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            print("Error: OPENAI_API_KEY not found in environment variables", file=sys.stderr)
            return "0"
        
        client = OpenAI(api_key=api_key)
        
        # Create temporary file for image download
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
            temp_image_path = temp_file.name
            temp_files.append(temp_image_path)
        
        # Download the image
        if not download_image(image_url, temp_image_path, github_token):
            return "0"
        
        # Compress the image
        compressed_path = compress_image(temp_image_path)
        if compressed_path != temp_image_path:
            temp_files.append(compressed_path)
        
        # Read and encode the image
        with open(compressed_path, 'rb') as image_file:
            image_data = image_file.read()
            base64_image = base64.b64encode(image_data).decode('utf-8')
        
        # Determine content type
        content_type = "image/jpeg" if compressed_path.endswith('.jpg') else "image/png"
        data_uri = f"data:{content_type};base64,{base64_image}"
        
        if enable_detailed:
            system_content = (
                "You are a compassionate educational assessment AI for image validation. Your role is to evaluate student image submissions with understanding and flexibility. "
                "Think like a supportive teacher who wants students to succeed. If the student's image demonstrates understanding of the concept, accept it even if it's not perfect. "
                "Be extremely lenient and forgiving. Accept images that show the student knows the material, even if they: "
                "- Use different drawing styles or tools than expected "
                "- Have minor errors in notation or labeling "
                "- Include extra elements that don't hurt their answer "
                "- Use different colors, shapes, or formatting "
                "- Have hand-drawn elements that are slightly imperfect "
                "- Show partial diagrams that demonstrate understanding "
                "- Use alternative representations of the same concepts "
                "- Include personal notes or annotations "
                "Only reject images that are completely wrong, show no understanding, or are completely off-topic. "
                "If the student demonstrates ANY understanding of the concept through their image, give them the benefit of the doubt. "
                "If ALL criteria are met OR the image shows understanding, return only '1'. If the image shows NO understanding or is completely wrong, return '0|<helpful, encouraging feedback>'. "
                "The feedback should be supportive and constructive. Instead of saying 'wrong', say 'almost there' or 'good start, but...'. Give specific, actionable guidance without revealing the exact answer. Keep feedback encouraging and under 30 words."
            )
        else:
            system_content = (
                "You are a compassionate educational assessment AI for image validation. Think like a supportive teacher who wants students to succeed. "
                "Be extremely lenient and forgiving. If the student's image demonstrates ANY understanding of the concept, accept it even if it's not perfectly formatted or drawn. "
                "Accept images that show knowledge, even if they: "
                "- Use different drawing styles or tools than expected "
                "- Have minor errors in notation or labeling "
                "- Include extra elements that don't hurt their answer "
                "- Use different colors, shapes, or formatting "
                "- Have hand-drawn elements that are slightly imperfect "
                "- Show partial diagrams that demonstrate understanding "
                "- Use alternative representations of the same concepts "
                "Only reject images that are completely wrong, show no understanding, or are completely off-topic. "
                "If the student demonstrates ANY understanding of the concept through their image, give them the benefit of the doubt. "
                "Return '1' for images that show understanding (even if imperfect), or '0' only for completely wrong images that show no knowledge of the topic."
            )
        
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_content},
                {
                    "role": "user", 
                    "content": [
                        {
                            "type": "text",
                            "text": validation_prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": data_uri
                            }
                        }
                    ]
                }
            ],
            temperature=temperature if 0.0 <= temperature <= 2.0 else 0.1,
            max_tokens=100,  # Slightly higher for image analysis
        )
        result = resp.choices[0].message.content.strip()
        
        # Normalize outputs
        if result == "1":
            return "1"
        if result == "0":
            return "0"
        
        # If detailed mode, accept 0|feedback format
        if enable_detailed and result.startswith("0|"):
            return result
        
        # Robust interpretation
        lower = result.lower()
        if "valid" in lower or "correct" in lower or "yes" in lower or "true" in lower:
            return "1"
        if "invalid" in lower or "incorrect" in lower or "no" in lower or "false" in lower:
            return "0"
        
        # Fallback
        print(f"Warning: Unexpected response from AI: '{result}', defaulting to '0'", file=sys.stderr)
        return "0"
                
    except ImportError as e:
        print(f"Error: Required package not found: {e}. Please install with: pip install openai pillow requests", file=sys.stderr)
        return "0"
    except Exception as e:
        print(f"Error: Unexpected error during image validation: {e}", file=sys.stderr)
        return "0"
    finally:
        # Clean up temporary files
        for temp_file in temp_files:
            try:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
            except Exception as e:
                print(f"Warning: Failed to delete temporary file {temp_file}: {e}", file=sys.stderr)

def main():
    # Args: validation_prompt (JSON-encoded), image_url (JSON-encoded), enableDetailed (true/false), temperature, github_token (optional, JSON-encoded)
    if len(sys.argv) < 3:
        print("0")
        return
    
    # Parse JSON-encoded strings (JSON.stringify() adds quotes)
    import json
    try:
        validation_prompt = json.loads(sys.argv[1])
    except (json.JSONDecodeError, ValueError):
        # Fallback: if it's not valid JSON, use it as-is (for backward compatibility)
    validation_prompt = sys.argv[1]
    
    try:
        image_url = json.loads(sys.argv[2])
    except (json.JSONDecodeError, ValueError):
    image_url = sys.argv[2]
    
    enable_flag = False
    temp = 0.1
    github_token = None
    
    if len(sys.argv) >= 4:
        enable_flag = sys.argv[3].lower() == 'true'
    if len(sys.argv) >= 5:
        try:
            temp = float(sys.argv[4])
        except:
            temp = 0.1
    if len(sys.argv) >= 6:
        token_arg = sys.argv[5]
        if token_arg != 'null':
            try:
                github_token = json.loads(token_arg)
            except (json.JSONDecodeError, ValueError):
                github_token = token_arg
        else:
            github_token = None
    
    print(validate_image_answer(validation_prompt, image_url, enable_flag, temp, github_token))

if __name__ == "__main__":
    main()

