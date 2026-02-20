import sys
import dspy
import json
import os
from dotenv import load_dotenv
load_dotenv()

gpt = dspy.LM('openai/gpt-4o-mini')
dspy.settings.configure(lm=gpt)


def load_json() -> list[str]:
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json")
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
    results = []
    for quest in data.get('questSequence', []):
        for task_id, task_data in quest.get('tasks', {}).items():
            if 'detailedHints' in task_data:
                for hint in task_data['detailedHints']:
                    if 'content' in hint:
                        results.append(hint['content'])
    return results

def load_info(quest,task):
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json")
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
    for quest_data in data.get('questSequence', []):
        if quest_data.get('questId') == quest:
            return quest_data.get('tasks', {}).get(task, {})
    return {}

def load_hints(quest,task):
    file_path = os.path.join(os.path.dirname(__file__), "config", "quest-sequence.json")
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
    for quest_data in data.get('questSequence', []):
        if quest_data.get('questId') == quest:
            task_data = quest_data.get('tasks', {}).get(task, {})
            if 'detailedHints' in task_data:
                return [hint['content'] for hint in task_data['detailedHints']]
    return []
    
class RAG(dspy.Module):
    def __init__(self):
        self.respond = dspy.Predict('context, question -> response')

    def forward(self, question):
        return self.respond(context=load_json(),question=question)

def ragAnswer(quest,task):
    prompt = load_info(quest,task)
    hints = load_hints(quest,task)
    quest = f"""Based on this task and these hints create one new
    hint and return just that hint,task:{prompt},hints {hints}"""
    rep = RAG()
    return rep(question=quest).response
    

if __name__ == '__main__':
    print(ragAnswer(sys.argv[1],sys.argv[2]))
