import os
import sys
import argparse
import json
from typing import Any

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Install with: pip install pymongo", file=sys.stderr)
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Set a stored value for a user in user_data.storedValues")
    parser.add_argument("--uri", default=os.getenv("URI"), help="MongoDB URI (env: URI)")
    parser.add_argument("--db", dest="db_name", default=os.getenv("DB_NAME"), help="Database name (env: DB_NAME)")
    parser.add_argument("--user-id", required=True, help="User document _id (e.g., username or username-class)")
    parser.add_argument("--key", required=True, help="storedValues key to set (e.g., Jabrefstars)")
    parser.add_argument("--value", required=True, help="Value to set")
    parser.add_argument("--type", choices=["auto", "number", "string", "json"], default="auto", help="How to parse the value")
    return parser.parse_args()


def coerce_value(raw: str, mode: str) -> Any:
    if mode == "string":
        return raw
    if mode == "number":
        try:
            if "." in raw:
                return float(raw)
            return int(raw)
        except ValueError:
            raise SystemExit(f"Invalid number: {raw}")
    if mode == "json":
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise SystemExit(f"Invalid JSON: {raw}")
    # auto
    # try number, then json, else string
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        pass
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    return raw


def main() -> None:
    args = parse_args()
    if not args.uri or not args.db_name:
        print("Error: --uri and --db (or env URI/DB_NAME) are required", file=sys.stderr)
        sys.exit(2)

    value = coerce_value(args.value, args.type)

    client = MongoClient(args.uri)
    db = client[args.db_name]
    coll = db["user_data"]

    path = f"user_data.storedValues.{args.key}"

    before = coll.find_one({"_id": args.user_id}, {"user_data.storedValues": 1}) or {}
    print("Before:", (before.get("user_data") or {}).get("storedValues"))

    result = coll.update_one({"_id": args.user_id}, {"$set": {path: value}}, upsert=True)
    print("Update result:", {"matched": result.matched_count, "modified": result.modified_count, "upserted_id": str(result.upserted_id) if result.upserted_id else None})

    after = coll.find_one({"_id": args.user_id}, {"user_data.storedValues": 1}) or {}
    print("After:", (after.get("user_data") or {}).get("storedValues"))

    client.close()


if __name__ == "__main__":
    main() 