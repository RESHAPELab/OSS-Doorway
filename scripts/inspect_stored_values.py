import os
import sys
import argparse
from typing import Dict, Any

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Install with: pip install pymongo", file=sys.stderr)
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect per-student saved values (user_data.storedValues) in MongoDB"
    )
    parser.add_argument("--uri", default=os.getenv("URI"), help="MongoDB connection URI (env: URI)")
    parser.add_argument("--db", dest="db_name", default=os.getenv("DB_NAME"), help="Mongo database name (env: DB_NAME)")
    parser.add_argument("--exact-id", dest="exact_id", default=None, help="Query a single user document by exact _id (e.g., username or username-class)")
    parser.add_argument("--class-id", dest="class_id", default=None, help="Filter by user_data.customGroupId (classId)")
    parser.add_argument("--group-name", dest="group_name", default=None, help="Filter by users whose _id ends with -<groupName> (case-insensitive)")
    parser.add_argument("--data-name", dest="data_name", default=None, help="Only show this stored key (e.g., Jabrefstars)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of results (0 = no limit)")
    return parser.parse_args()


def build_filter(args: argparse.Namespace) -> Dict[str, Any]:
    if args.exact_id:
        return {"_id": args.exact_id}
    if args.class_id:
        return {"user_data.customGroupId": args.class_id}
    if args.group_name:
        suffix = f"-{args.group_name.lower()}"
        return {"_id": {"$regex": f"{suffix}$", "$options": "i"}}
    return {"user_data.storedValues": {"$exists": True}}


def main() -> None:
    args = parse_args()

    if not args.uri or not args.db_name:
        print("Error: --uri and --db (or env URI/DB_NAME) are required", file=sys.stderr)
        sys.exit(2)

    client = MongoClient(args.uri)
    db = client[args.db_name]
    coll = db["user_data"]

    query = build_filter(args)
    projection = {"user_data.storedValues": 1}

    cursor = coll.find(query, projection)
    if args.limit > 0:
        cursor = cursor.limit(args.limit)

    docs = list(cursor)

    total_users = len(docs)
    print(f"Matched users: {total_users}")

    if total_users == 0:
        client.close()
        return

    if args.data_name:
        key = args.data_name
        present_count = 0
        for doc in docs:
            values = (doc.get("user_data") or {}).get("storedValues") or {}
            if key in values:
                present_count += 1
        print(f"Users with '{key}' saved: {present_count}/{total_users}")
        print("")
        for doc in docs:
            user_id = doc.get("_id")
            values = (doc.get("user_data") or {}).get("storedValues") or {}
            if key in values:
                print(f"- {user_id}: {values[key]}")
    else:
        for doc in docs:
            user_id = doc.get("_id")
            values = (doc.get("user_data") or {}).get("storedValues") or {}
            print(f"\nUser: {user_id}")
            if not values:
                print("  (no storedValues)")
                continue
            for k, v in values.items():
                print(f"  {k}: {v}")

    client.close()


if __name__ == "__main__":
    main() 