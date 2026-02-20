#!/usr/bin/env python3
import os
import sys
import json
import argparse
from typing import Dict, Any, Optional, List, Tuple

try:
	from pymongo import MongoClient
except ImportError:
	print("Error: pymongo is not installed. Install with: pip install pymongo", file=sys.stderr)
	sys.exit(1)

try:
	import requests
except ImportError:
	print("Error: requests is not installed. Install with: pip install requests", file=sys.stderr)
	sys.exit(1)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Analyze repo quest progress across all user repos")
	parser.add_argument("--uri", default=os.getenv("URI"), help="MongoDB connection URI (env: URI)")
	parser.add_argument("--db", dest="db_name", default=os.getenv("DB_NAME"), help="Mongo database name (env: DB_NAME)")
	parser.add_argument("--backend", default=os.getenv("BACKEND_URL", "https://oss-michael-production.up.railway.app"), help="Backend base URL (default: https://oss-michael-production.up.railway.app)")
	parser.add_argument("--limit", type=int, default=0, help="Limit number of repos (0 = no limit)")
	parser.add_argument("--only", default=None, help="Only analyze a specific repo name (user_data.username)")
	return parser.parse_args()


def get_class_id_for_repo(backend: str, repo_name: str) -> Optional[str]:
	try:
		url = f"{backend}/api/group/repo/{repo_name}/class"
		resp = requests.get(url, timeout=15)
		if resp.status_code == 200:
			data = resp.json()
			if data.get("success") and data.get("data", {}).get("classId"):
				return data["data"]["classId"]
			return None
		else:
			return None
	except Exception as e:
		print(f"  ⚠️ Failed to resolve classId from backend for {repo_name}: {e}")
		return None


def get_quest_config(backend: str, class_id: str) -> Optional[Dict[str, Any]]:
	try:
		url = f"{backend}/api/group/{class_id}/quest-json-config"
		resp = requests.get(url, timeout=20)
		if resp.status_code == 200:
			data = resp.json()
			return data.get("data", {}).get("questJsonConfig")
		return None
	except Exception as e:
		print(f"  ⚠️ Failed to fetch quest config for class {class_id}: {e}")
		return None


def last_in_sequence(quest_json_config: Dict[str, Any]) -> Optional[str]:
	seq: List[Dict[str, Any]] = quest_json_config.get("questSequence", [])
	if not seq:
		return None
	# Prefer sequenceNumber if present, fallback to array order
	with_seq = [q for q in seq if isinstance(q.get("sequenceNumber"), int)]
	if with_seq:
		last_q = max(with_seq, key=lambda q: q.get("sequenceNumber", -1))
		return last_q.get("questId")
	# fallback to last item
	return seq[-1].get("questId")


def build_order_index(quest_json_config: Dict[str, Any]) -> Dict[str, int]:
	order: Dict[str, int] = {}
	for idx, q in enumerate(quest_json_config.get("questSequence", [])):
		qid = q.get("questId")
		if qid:
			order[qid] = q.get("sequenceNumber", idx)
	return order


def compute_last_completed(order_index: Dict[str, int], completed_map: Dict[str, Any]) -> Optional[str]:
	if not completed_map:
		return None
	# Pick quest in completed with the highest order
	best_qid = None
	best_order = -1
	for qid in completed_map.keys():
		ord_val = order_index.get(qid, -1)
		if ord_val > best_order:
			best_order = ord_val
			best_qid = qid
	return best_qid


def main() -> None:
	args = parse_args()
	if not args.uri or not args.db_name:
		print("Error: --uri and --db (or env URI/DB_NAME) are required", file=sys.stderr)
		sys.exit(2)

	client = MongoClient(args.uri)
	db = client[args.db_name]
	coll = db["user_data"]

	query: Dict[str, Any] = {"_id": {"$exists": True}}
	if args.only:
		query = {"_id": {"$regex": f"{args.only}", "$options": "i"}}

	cursor = coll.find(query)
	if args.limit > 0:
		cursor = cursor.limit(args.limit)

	repos_processed = 0
	print("Repo, ClassId, LastInSequence, LastCompleted, CurrentQuest")
	for doc in cursor:
		raw_user_data = doc.get("user_data")
		user_data = raw_user_data if isinstance(raw_user_data, dict) else {}
		repo_name = user_data.get("username") or doc.get("_id")
		class_id = user_data.get("customGroupId") if isinstance(user_data.get("customGroupId"), str) else None
		if not class_id:
			class_id = get_class_id_for_repo(args.backend, repo_name)

		quest_config = get_quest_config(args.backend, class_id) if class_id else None
		last_seq_qid = last_in_sequence(quest_config) if quest_config else None
		order_index = build_order_index(quest_config) if quest_config else {}

		completed_field = user_data.get("completed")
		completed_map = completed_field if isinstance(completed_field, dict) else {}
		last_completed_qid = compute_last_completed(order_index, completed_map)
		current_field = user_data.get("current")
		current_q = current_field.get("quest") if isinstance(current_field, dict) else None

		print(f"{repo_name}, {class_id or '-'}, {last_seq_qid or '-'}, {last_completed_qid or '-'}, {current_q or '-'}")
		repos_processed += 1

	client.close()
	if repos_processed == 0:
		print("(no repos matched)\n", file=sys.stderr)


if __name__ == "__main__":
	main() 