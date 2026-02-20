import sys
import dspy
import json
import os
from dotenv import load_dotenv
load_dotenv()

gpt = dspy.LM('openai/gpt-4o-mini')
dspy.settings.configure(lm=gpt)

def load_json() -> list[str]:
    # Updated to use relative path that works both locally and in Docker
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json") 
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  
    results = []
    
    # Extract all quest responses from quest-sequence.json
    for quest in data.get('questSequence', []):
        for task_id, task_data in quest.get('tasks', {}).items():
            for response_type, response_text in task_data.items():
                if response_text and isinstance(response_text, str):
                    results.append(response_text)
    
    return results

class RAG(dspy.Module):
    def __init__(self):
        self.respond = dspy.Predict('context, question -> response')

    def forward(self, question):
        return self.respond(context=load_json(), question=question)

def quizAnswer(answer, format):
    quest = f"""You are a strict formatter.  
        You will be given two things:
        1. An Input sentence containing the answer(s).  
        2. A Format string showing exactly how I want those answer values arranged, using placeholders A, B, C, … in the spots where each value should go.  

        Your job is:
        - Extract the answer value(s) from the Input.
        - Substitute them for the placeholders in the Format string, in order.
        - Output **only** the fully formatted result—absolutely no extra words, punctuation, or explanation.
        Examples:

        Input: "the answer is 15"  
        Format: "01"  
        Output:15

        Input: "the answers are  A, A, A A"  
        Format: "[A,B,C,D]"  
        Output:[A,A,A,A]

    Now do this:

    Input: {answer}  
    Format: {format}
    Output:"""
    rep = RAG()
    return rep(question=quest).response

if __name__ == '__main__':
    print(quizAnswer(sys.argv[1], sys.argv[2]))

