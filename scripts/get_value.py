import os
import sys
import argparse
from typing import Any

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Install with: pip install pymongo", file=sys.stderr)
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Get a stored value for a user from user_data.storedValues")
    parser.add_argument("--uri", default=os.getenv("URI"), help="MongoDB URI (env: URI)")
    parser.add_argument("--db", dest="db_name", default=os.getenv("DB_NAME"), help="Database name (env: DB_NAME)")
    parser.add_argument("--user-id", required=False, help="User document _id (e.g., username or username-class)")
    parser.add_argument("--key", required=True, help="storedValues key to get (e.g., Jabrefstars)")
    parser.add_argument("--class-id", dest="class_id", default=None, help="If --user-id not provided, return all users with this classId (user_data.customGroupId)")
    parser.add_argument("--group-name", dest="group_name", default=None, help="If --user-id not provided, return users whose _id ends with -<groupName>")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.uri or not args.db_name:
        print("Error: --uri and --db (or env URI/DB_NAME) are required", file=sys.stderr)
        sys.exit(2)

    client = MongoClient(args.uri)
    db = client[args.db_name]
    coll = db["user_data"]

    projection = {"user_data.storedValues": 1}

    results = []
    if args.user_id:
        doc = coll.find_one({"_id": args.user_id}, projection)
        if doc:
            values = (doc.get("user_data") or {}).get("storedValues") or {}
            results.append((doc.get("_id"), values.get(args.key)))
    else:
        query = {}
        if args.class_id:
            query = {"user_data.customGroupId": args.class_id}
        elif args.group_name:
            suffix = f"-{args.group_name.lower()}"
            query = {"_id": {"$regex": f"{suffix}$", "$options": "i"}}
        else:
            query = {f"user_data.storedValues.{args.key}": {"$exists": True}}

        for doc in coll.find(query, projection):
            values = (doc.get("user_data") or {}).get("storedValues") or {}
            results.append((doc.get("_id"), values.get(args.key)))

    client.close()

    if not results:
        print("No results")
        return

    for uid, val in results:
        print(f"{uid}: {val}")


if __name__ == "__main__":
    main() 