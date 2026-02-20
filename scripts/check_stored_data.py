#!/usr/bin/env python3
import argparse
import sys
import json
from typing import Any, Dict

try:
    import requests
except ImportError:
    print("This script requires 'requests'. Install with: pip3 install requests", file=sys.stderr)
    sys.exit(1)


def resolve_class_id(base_url: str, class_id: str | None, repo: str | None) -> str:
    if class_id:
        return class_id
    if not repo:
        raise ValueError("You must provide either --class-id or --repo")
    url = f"{base_url.rstrip('/')}/api/group/repo/{repo}/class"
    r = requests.get(url, timeout=10)
    if r.status_code != 200:
        raise RuntimeError(f"Failed to resolve class from repo. Status {r.status_code}: {r.text}")
    data = r.json().get('data', {})
    cid = data.get('classId')
    if not cid:
        raise RuntimeError(f"Response did not include classId: {r.text}")
    return cid


def get_stored_values(base_url: str, class_id: str) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/group/{class_id}/stored-values"
    r = requests.get(url, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"Failed to fetch stored values. Status {r.status_code}: {r.text}")
    return r.json().get('data', {})


def pretty_print(data: Dict[str, Any]) -> None:
    keys = data.get('keys', [])
    values_by_user = data.get('valuesByUser', {})

    print("Configured Keys (from quest JSON):")
    if not keys:
        print("  - None")
    else:
        for k in keys:
            quest_id = k.get('questId') or k.get('quest') or ''
            task_id = k.get('taskId') or k.get('task') or ''
            print(f"  - {k.get('dataName')} (Quest: {quest_id}, Task: {task_id}, Expected: {k.get('expectedType')})")

    print("\nPer-user Values:")
    if not values_by_user:
        print("  - None recorded")
        return

    # Invert values_by_user to group by key
    grouped: Dict[str, Dict[str, Any]] = {}
    for user, kv in values_by_user.items():
        if not isinstance(kv, dict):
            continue
        for key, val in kv.items():
            grouped.setdefault(key, {})[user] = val

    if not grouped:
        print("  - None recorded")
        return

    for key, user_map in grouped.items():
        print(f"  - {key} — Saved by {len(user_map)} student(s)")
        for user, val in user_map.items():
            print(f"      {user}: {val}")


def main():
    parser = argparse.ArgumentParser(description="Check configured stored-data keys and per-user values for a class.")
    parser.add_argument('--base-url', default='http://localhost:8080', help='Management backend base URL (default: http://localhost:8080)')
    parser.add_argument('--class-id', help='Mongo ObjectId of the class/group')
    parser.add_argument('--repo', help='Repo name to resolve class (e.g., MisanEtchie-financing)')
    args = parser.parse_args()

    try:
        class_id = resolve_class_id(args.base_url, args.class_id, args.repo)
        data = get_stored_values(args.base_url, class_id)
        print(f"Class ID: {class_id}\n")
        pretty_print(data)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main() 