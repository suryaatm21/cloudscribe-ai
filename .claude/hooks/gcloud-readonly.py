#!/usr/bin/env python3
"""PreToolUse hook for Bash: the single source of truth for agent gcloud access.

Allows a gcloud call only when every segment of the command matches an exact
read-only path in ALLOWED_PATHS; anything else that mentions gcloud is denied
(exit 2). Commands that never mention gcloud pass through untouched. The
settings.json wrapper turns any hook crash into a deny. To permit another read,
add its exact path here and a case in test_readonly_hook.py.
"""
import json
import re
import shlex
import sys

ALLOWED_PATHS = {
    ("config", "list"),
    ("projects", "describe"), ("projects", "list"), ("projects", "get-iam-policy"),
    ("services", "list"),
    ("run", "services", "describe"), ("run", "services", "list"), ("run", "services", "get-iam-policy"),
    ("run", "revisions", "describe"), ("run", "revisions", "list"),
    ("functions", "describe"), ("functions", "list"), ("functions", "get-iam-policy"),
    ("pubsub", "topics", "describe"), ("pubsub", "topics", "list"), ("pubsub", "topics", "get-iam-policy"),
    ("pubsub", "subscriptions", "describe"), ("pubsub", "subscriptions", "list"), ("pubsub", "subscriptions", "get-iam-policy"),
    ("scheduler", "jobs", "describe"), ("scheduler", "jobs", "list"),
    ("builds", "describe"), ("builds", "list"),
    ("builds", "triggers", "describe"), ("builds", "triggers", "list"),
    ("storage", "buckets", "describe"), ("storage", "buckets", "list"), ("storage", "buckets", "get-iam-policy"),
    ("storage", "buckets", "notifications", "describe"), ("storage", "buckets", "notifications", "list"),
    ("storage", "objects", "describe"), ("storage", "objects", "list"),
    ("artifacts", "repositories", "describe"), ("artifacts", "repositories", "list"), ("artifacts", "repositories", "get-iam-policy"),
    ("artifacts", "docker", "images", "describe"), ("artifacts", "docker", "images", "list"),
    ("iam", "service-accounts", "describe"), ("iam", "service-accounts", "list"), ("iam", "service-accounts", "get-iam-policy"),
    ("firestore", "databases", "describe"), ("firestore", "databases", "list"),
    ("firestore", "indexes", "composite", "describe"), ("firestore", "indexes", "composite", "list"),
    ("logging", "metrics", "describe"), ("logging", "metrics", "list"),
    ("monitoring", "policies", "describe"), ("monitoring", "policies", "list"),
    ("billing", "budgets", "describe"), ("billing", "budgets", "list"),
}


def deny(reason):
    print(f"gcloud is limited to an allowlist of read-only commands: {reason}", file=sys.stderr)
    sys.exit(2)


def check_segment(seg):
    rest = seg
    if not any("gcloud" in t.lower() for t in rest):
        return False
    if rest[0].lower() != "gcloud":
        deny(f"gcloud not invoked directly ({rest[0]})")
    if any("gcloud" in t.lower() for t in rest[1:]):
        deny("gcloud appears as an argument")
    pos = []
    for t in rest[1:]:
        if t.startswith("-"):
            break
        pos.append(t)
    # Every allowed path ends in a leaf read command, so any words after it are
    # resource arguments (a service name, a repository path) and cannot select a
    # different command.
    if any(tuple(pos[:end]) in ALLOWED_PATHS for end in range(1, len(pos) + 1)):
        return True
    deny("command path is not on the read-only allowlist")


def main():
    try:
        command = json.load(sys.stdin)["tool_input"]["command"]
    except Exception:
        deny("could not read hook input")
    if not isinstance(command, str):
        deny("could not read hook input")
    # Join backslash-newline continuations as bash does, but only when the
    # backslash is not itself escaped: "\\" followed by a newline still ends the command.
    command = re.sub(r"(?<!\\)((?:\\\\)*)\\\n", r"\1", command)
    probe = command.replace("\\", "").replace("'", "").replace('"', "").lower()
    if "gcloud" not in command.lower() and "gcloud" not in probe:
        return
    # The tokenizer below does not treat "#" as a comment the way bash does, so a
    # quote or a trailing backslash inside a comment could hide a second command.
    if re.search(r"[`$<>{}#]", command):
        deny("substitution, redirection, expansion or comment near gcloud")
    try:
        lexer = shlex.shlex(re.sub(r"[\r\n]+", " ; ", command), posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        deny("unparseable command")
    segments, cur = [], []
    for t in tokens:
        if set(t) <= set(";&|()"):
            segments.append(cur)
            cur = []
        else:
            cur.append(t)
    segments.append(cur)
    segments = [s for s in segments if s]
    results = [check_segment(s) for s in segments]
    if segments and all(results):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "read-only gcloud",
        }}))


main()
