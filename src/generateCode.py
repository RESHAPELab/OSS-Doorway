#!/usr/bin/env python3
import sys
import os
import json
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

def generate_code(prompt: str, temperature: float):
    try:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            print("Error: OPENAI_API_KEY not found in environment variables", file=sys.stderr)
            return json.dumps({"error": "API key not found"})
        
        client = OpenAI(api_key=api_key)
        
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=temperature if 0.0 <= temperature <= 2.0 else 0.3,
            max_tokens=4000,
        )
        result = resp.choices[0].message.content.strip()
        return result
        
    except Exception as e:
        print(f"Error in generate_code: {e}", file=sys.stderr)
        return json.dumps({"error": str(e)})

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing prompt argument"}))
        return
    
    # Parse JSON-encoded prompt
    try:
        prompt = json.loads(sys.argv[1])
    except (json.JSONDecodeError, ValueError):
        # Fallback: if it's not valid JSON, use it as-is
        prompt = sys.argv[1]
    
    temperature = 0.3
    if len(sys.argv) >= 3:
        try:
            temperature = float(sys.argv[2])
        except:
            temperature = 0.3
    
    result = generate_code(prompt, temperature)
    print(result)

if __name__ == "__main__":
    main()
