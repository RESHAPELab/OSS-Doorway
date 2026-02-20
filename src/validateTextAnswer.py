#!/usr/bin/env python3
import sys
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

def validate_text_answer(validation_prompt: str, enable_detailed: bool, temperature: float):
    try:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            print("Error: OPENAI_API_KEY not found in environment variables", file=sys.stderr)
            return "0"
        
        client = OpenAI(api_key=api_key)
        
        if enable_detailed:
            system_content = (
                "You are a compassionate educational assessment AI. Your role is to evaluate student answers with understanding and flexibility. "
                "Think like a supportive teacher who wants students to succeed. If the student demonstrates understanding of the concept, accept their answer even if it's not perfectly formatted or worded. "
                "Be extremely lenient and forgiving. Accept answers that show the student knows the material, even if they: "
                "- Use different wording or phrasing than expected "
                "- Include extra information that doesn't hurt their answer "
                "- Have minor typos, capitalization errors, or grammatical mistakes "
                "- Provide partial answers that demonstrate understanding "
                "- Use synonyms or alternative expressions for key terms "
                "- Give examples instead of definitions (or vice versa) if both show knowledge "
                "- Include personal opinions or additional context that doesn't contradict the answer "
                "- Have typos in git commands or technical terms "
                "- Use different separators or formatting in commands "
                "- Misspell branch names or have minor variations in naming "
                "Examples of lenient evaluation: "
                "- If asked for '10/15', accept: '10/15', '10/15/2025', 'Wed 10/15', 'Wednesday 10/15', 'October 15th', 'the 15th', etc. "
                "- If asked 'what is the capital of the moon', accept: 'the moon', 'lunar capital', 'moon base', etc. "
                "- If asked to explain a concept, accept brief but correct explanations, even if incomplete "
                "- If asked for examples, accept partial lists as long as they show understanding "
                "- If asked for git commands, accept variations with typos as long as the intent is clear "
                "Only reject answers that are completely wrong, show no understanding, or are completely off-topic. "
                "If the student demonstrates ANY understanding of the concept, give them the benefit of the doubt. "
                "If ALL criteria are met OR the student shows understanding, return only '1'. If the answer shows NO understanding or is completely wrong, return '0|<helpful, encouraging feedback>'. "
                "The feedback should be supportive and constructive. Instead of saying 'wrong', say 'almost there' or 'good start, but...'. Give specific, actionable guidance without revealing the exact answer or validation criteria. "
                "NEVER mention specific option numbers, correct answers, or validation criteria in your feedback. Keep feedback encouraging and under 30 words. "
                "CRITICAL: DO NOT REVEAL THE ANSWER! Never say things like: "
                "- 'include 1 and 3' or 'avoid 2 and 4' "
                "- 'options 1 and 3 are correct' or '2 and 4 are wrong' "
                "- 'remember to include 1 and 3' or 'should include 1 and 3' "
                "- 'the correct answer is 1 and 3' or 'not include 2 and 4' "
                "- 'you need 1 and 3' or 'exclude 2 and 4' "
                "- Any specific numbers or option references "
                "INSTEAD, use generic guidance like: "
                "- 'Consider which reasons actually support this methodology' "
                "- 'Think about the characteristics of this approach' "
                "- 'Review what makes this methodology effective' "
                "- 'Consider the benefits and drawbacks mentioned' "
                "- 'Focus on the core principles of this method' "
                "- 'Look for reasons that align with this development process' "
                "- 'Consider which statements describe this methodology accurately' "
                "- 'Think about what Waterfall methodology is known for' "
                "- 'Consider which reasons match the sequential nature of Waterfall' "
                "FOR MULTIPLE CHOICE QUESTIONS: Never mention specific option numbers (1, 2, 3, 4, 5) or say which ones are correct/incorrect. Instead, guide them to think about the concepts."
                " For numeric option lists in student answers, NORMALIZE separators: treat commas, spaces, newlines, and the word 'and' as equivalent separators (e.g., '1 3', '1,3', '1 and 3', '1\n3' are identical). Evaluate option lists order-insensitively and ignore extra whitespace/punctuation."
            )
        else:
            system_content = (
                "You are a compassionate educational assessment AI. Think like a supportive teacher who wants students to succeed. "
                "Be extremely lenient and forgiving. If the student demonstrates ANY understanding of the concept, accept their answer even if it's not perfectly formatted or worded. "
                "Accept answers that show knowledge, even if they: "
                "- Use different wording or phrasing than expected "
                "- Include extra information that doesn't hurt their answer "
                "- Have minor typos, capitalization errors, or grammatical mistakes " 
                "- Provide partial answers that demonstrate understanding "
                "- Use synonyms or alternative expressions for key terms "
                "- Give examples instead of definitions (or vice versa) if both show knowledge "
                "- Have typos in git commands or technical terms "
                "- Use different separators or formatting in commands "
                "Examples of lenient evaluation: "
                "- If asked for '10/15', accept: '10/15', '10/15/2025', 'Wed 10/15', 'Wednesday 10/15', 'October 15th', 'the 15th', etc. "
                "- If asked 'what is the capital of the moon', accept: 'the moon', 'lunar capital', 'moon base', etc. "
                "- If asked to explain a concept, accept brief but correct explanations, even if incomplete "
                "- If asked for git commands, accept variations with typos as long as the intent is clear "
                "Only reject answers that are completely wrong, show no understanding, or are completely off-topic. "
                "If the student demonstrates ANY understanding of the concept, give them the benefit of the doubt. "
                "Return '1' for answers that show understanding (even if imperfect), or '0' only for completely wrong answers that show no knowledge of the topic."
                " For numeric option lists in student answers, NORMALIZE separators: treat commas, spaces, newlines, and the word 'and' as equivalent separators (e.g., '1 3', '1,3', '1 and 3', '1\n3' are identical). Evaluate option lists order-insensitively and ignore extra whitespace/punctuation."
            )
        
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": validation_prompt}
            ],
            temperature=temperature if 0.0 <= temperature <= 1.0 else 0.1,
            max_tokens=50,
        )
        result = resp.choices[0].message.content.strip()
        
        # Normalize outputs
        if result == "1":
            return "1"
        if result == "0":
            return "0"
        
        # If detailed mode, accept 1|feedback or 0|feedback format
        if enable_detailed and result.startswith("1|"):
            return result
        if enable_detailed and result.startswith("0|"):
            return result
        
        # Also accept 1|feedback format even if not detailed mode (for code review)
        if result.startswith("1|"):
            return result
        
        # Robust interpretation
        lower = result.lower()
        if "valid" in lower or "correct" in lower or "yes" in lower or "true" in lower or "approved" in lower:
            return "1"
        if "invalid" in lower or "incorrect" in lower or "no" in lower or "false" in lower:
            return "0"
        
        # Fallback
        print(f"Warning: Unexpected response from AI: '{result}', defaulting to '0'", file=sys.stderr)
        return "0"
                
    except ImportError:
        print("Error: OpenAI package not found. Please install it with: pip install openai", file=sys.stderr)
        return "0"
    except Exception as e:
        print(f"Error: Unexpected error during validation: {e}", file=sys.stderr)
        return "0"


def main():
    # Args: prompt (JSON-encoded string), enableDetailed (true/false), temperature
    if len(sys.argv) < 2:
        print("0")
        return
    
    # The prompt is JSON-encoded (with quotes), so we need to parse it
    import json
    try:
        # JSON.stringify() adds quotes, so we parse it to get the actual string
        prompt = json.loads(sys.argv[1])
    except (json.JSONDecodeError, ValueError):
        # Fallback: if it's not valid JSON, use it as-is (for backward compatibility)
        prompt = sys.argv[1]
    
    enable_flag = False
    temp = 0.1
    if len(sys.argv) >= 3:
        enable_flag = sys.argv[2].lower() == 'true'
    if len(sys.argv) >= 4:
        try:
            temp = float(sys.argv[3])
        except:
            temp = 0.1
    print(validate_text_answer(prompt, enable_flag, temp))

if __name__ == "__main__":
    main() 
    

