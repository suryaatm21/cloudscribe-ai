#!/usr/bin/env python3
import json
import re
import shlex
import sys

VERBS = {"describe", "list", "get-iam-policy"}
GROUPS = {
    "projects", "services", "run", "revisions", "functions", "pubsub", "topics",
    "subscriptions", "scheduler", "jobs", "builds", "triggers", "storage",
    "buckets", "notifications", "objects", "artifacts", "repositories",
    "docker", "images", "iam", "service-accounts", "firestore", "databases",
    "indexes", "composite", "logging", "metrics", "monitoring", "policies",
    "billing", "budgets",
}
SEPARATORS = {";", "&", "|", "&&", "||", "(", ")", ";;", "|&", "\n"}


def deny(reason):
    print(f"gcloud is read-only here (describe, list, get-iam-policy): {reason}", file=sys.stderr)
    sys.exit(2)


def check_segment(seg):
    i = 0
    while i < len(seg) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", seg[i]):
        if "gcloud" in seg[i]:
            deny("gcloud inside an env assignment")
        i += 1
    rest = seg[i:]
    if not any("gcloud" in t for t in rest):
        return
    if rest[0] != "gcloud":
        deny(f"gcloud not invoked directly ({rest[0]})")
    if any("gcloud" in t for t in rest[1:]):
        deny("gcloud appears as an argument")
    pos = []
    for t in rest[1:]:
        if t.startswith("-"):
            break
        pos.append(t)
    if pos == ["config", "list"]:
        return
    if not pos or pos[-1] not in VERBS and (len(pos) < 2 or pos[-2] not in VERBS):
        deny("final verb is not describe, list or get-iam-policy")
    verb_at = len(pos) - 1 if pos[-1] in VERBS else len(pos) - 2
    if not pos[:verb_at] or not all(g in GROUPS for g in pos[:verb_at]):
        deny("unrecognized command group")


def main():
    try:
        command = json.load(sys.stdin)["tool_input"]["command"]
    except Exception:
        deny("could not read hook input")
    if not isinstance(command, str):
        deny("could not read hook input")
    probe = command.replace("\\", "").replace("'", "").replace('"', "")
    if "gcloud" not in command and "gcloud" not in probe:
        return
    if re.search(r"[`$<>{}]", command):
        deny("substitution, redirection or expansion near gcloud")
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        deny("unparseable command")
    segments, cur = [], []
    for t in tokens:
        if t in SEPARATORS or set(t) <= set(";&|()"):
            segments.append(cur)
            cur = []
        else:
            cur.append(t)
    segments.append(cur)
    for seg in segments:
        if seg:
            check_segment(seg)


main()
