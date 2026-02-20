import sys
import dspy
import json
import os
from dotenv import load_dotenv
load_dotenv()

gpt = dspy.LM('openai/gpt-4o-mini')
dspy.settings.configure(lm=gpt)

def load_file() -> list[str]:
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json") 
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  
    results = []
    
    for quest in data.get('questSequence', []):
        for task_id, task_data in quest.get('tasks', {}).items():
            for response_type, response_text in task_data.items():
                if response_text and isinstance(response_text, str):
                    results.append(response_text)
    
    return results

def load_json(quest, task) -> list[str]:
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json") 
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  
    
    for quest_data in data.get('questSequence', []):
        if quest_data.get('questId') == quest:
            task_data = quest_data.get('tasks', {}).get(task, {})
            return task_data.get('accept', '')
    
    return ''

class RAG(dspy.Module):
    def __init__(self):
        self.respond = dspy.Predict('context, question -> response')

    def forward(self, question):
        return self.respond(context=load_file(), question=question)

def checkAnswer(answer, realAnswer, quest, task):
    context = load_json(quest, task)
    quest = f"""context{context} if this answer is the similar as correct, return true else return
    false, answer:{answer} correct answer:{realAnswer}"""
    rep = RAG()
    return rep(question=quest).response

if __name__ == '__main__':
    print(checkAnswer(sys.argv[1], sys.argv[2], quest=sys.argv[3], task=sys.argv[4]))

