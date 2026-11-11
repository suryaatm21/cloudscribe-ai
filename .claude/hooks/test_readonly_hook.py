"""Tests for the read-only gcloud PreToolUse hook.

Each case runs the hook command from .claude/settings.json through /bin/sh with
a Bash tool-call payload on stdin, the way Claude Code invokes it, and checks the
decision. No case executes gcloud.

Run: python3 -m unittest discover -s .claude/hooks -p "test_*.py" -v
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = json.loads((ROOT / ".claude" / "settings.json").read_text())

ALLOW, DENY, PASSTHROUGH = "allow", "deny", "passthrough"


def hook_command():
    entry = SETTINGS["hooks"]["PreToolUse"][0]
    assert entry["matcher"] == "Bash"
    return entry["hooks"][0]["command"]


def decide(command=None, payload=None, project_dir=ROOT, path=None):
    """Return (decision, exit code, stderr) for one Bash tool call."""
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(project_dir))
    if path is not None:
        env["PATH"] = path
    data = payload if payload is not None else json.dumps(
        {"tool_name": "Bash", "tool_input": {"command": command}})
    proc = subprocess.run(["/bin/sh", "-c", hook_command()], input=data,
                          capture_output=True, text=True, env=env)
    if proc.returncode == 2:
        decision = DENY
    elif proc.returncode == 0 and proc.stdout.strip():
        out = json.loads(proc.stdout)["hookSpecificOutput"]
        decision = ALLOW if out["permissionDecision"] == "allow" else out["permissionDecision"]
    elif proc.returncode == 0:
        decision = PASSTHROUGH
    else:
        decision = f"exit {proc.returncode}"
    return decision, proc.returncode, proc.stderr


# Reads on the allowlist: the hook approves them so they run without a prompt.
READS_ALLOWED = [
    "gcloud run services describe video-processing-service --region=us-central1",
    "gcloud run services list",
    "gcloud run services get-iam-policy svc",
    "gcloud functions list",
    "gcloud functions describe fn --region us-central1",
    "gcloud functions describe createUser --region us-central1",
    "gcloud builds describe 123",
    "gcloud builds list --limit=5",
    "gcloud builds triggers describe t",
    "gcloud builds triggers list",
    "gcloud pubsub subscriptions list",
    "gcloud pubsub subscriptions get-iam-policy video-processing-subscription",
    "gcloud pubsub topics describe transcription-jobs",
    "gcloud scheduler jobs list",
    "gcloud storage buckets describe gs://atmuri-yt-transcripts",
    "gcloud projects describe my-proj",
    "gcloud config list",
    "gcloud run services describe svc --format=json",
    "gcloud run services describe svc --format='value(status.url)'",
    "GCLOUD run services describe s",
    "Gcloud functions list",
    "gcloud run services list && gcloud functions list",
    # Positional resource arguments after a read verb.
    "gcloud artifacts docker images list us-central1-docker.pkg.dev/yt-clone-385f4/video-processing-service --include-tags",
    "gcloud storage objects list gs://atmuri-yt-transcripts/normalized",
    # The listing command in docs/cost-operations.md, line continuations included.
    "gcloud artifacts docker images list \\\n"
    "  us-central1-docker.pkg.dev/yt-clone-385f4/video-processing-service \\\n"
    "  --include-tags",
]

# Commands that change, deploy, delete, spend, or expose credentials.
MUTATIONS_DENIED = [
    "gcloud run deploy svc --image x",
    "gcloud run services delete svc",
    "gcloud run services update svc --set-env-vars A=b",
    "gcloud run services update-traffic svc --to-latest",
    "gcloud functions deploy fn",
    "gcloud functions delete fn",
    "gcloud builds submit",
    "gcloud builds submit .",
    "gcloud storage rm gs://b/o",
    "gcloud storage buckets delete gs://b",
    "gcloud pubsub topics create t",
    "gcloud pubsub topics publish t --message x",
    "gcloud tasks queues purge q",
    "gcloud config set project p",
    "gcloud auth login",
    "gcloud auth print-access-token",
    "gcloud iam service-accounts keys create k.json --iam-account a@b",
    "gcloud projects add-iam-policy-binding p --member m --role r",
    "gcloud scheduler jobs run job",
    "gcloud builds cancel 1",
    "gcloud compute instances create vm",
    "GCLOUD run services delete s",
    "Gcloud functions deploy f",
    "gCloud builds submit",
    # Mutating paths that end in a read verb.
    "gcloud builds triggers run describe",
    "gcloud run jobs run list",
    "gcloud scheduler jobs run describe",
    "GCLOUD builds triggers run describe",
]

# Reads that are not on the allowlist, or that put a flag before the command
# path, are denied too: only listed paths count as read-only.
UNLISTED_DENIED = [
    "gcloud logging read severity=ERROR",
    "gcloud eventarc triggers list",
    "gcloud --project=p functions list",
]

# A mutating gcloud call hidden next to a read.
HIDDEN_DENIED = [
    "gcloud run services list; gcloud run services delete s",
    "gcloud run services list && gcloud functions delete f",
    "gcloud run services list || gcloud functions delete f",
    "gcloud run services list | gcloud functions delete f",
    "gcloud run services list |& gcloud functions delete f",
    "gcloud run services list & gcloud functions delete f",
    "gcloud run services list\ngcloud functions delete f",
    "gcloud run services list\rgcloud functions delete f",
    "(gcloud run services list; gcloud functions delete f)",
    "gcloud config list --foo; gcloud run services delete s",
    "gcloud run services list # ; gcloud functions delete f",
    "echo $(gcloud functions delete f)",
    "echo `gcloud functions delete f`",
    "gcloud run services list \\\\\ngcloud functions delete f",
]

# gcloud behind wrappers, env prefixes, paths, redirection, or as an argument.
INDIRECT_DENIED = [
    "PATH=./bin gcloud projects describe p",
    "CLOUDSDK_PYTHON=x gcloud projects describe p",
    "FOO=bar gcloud run services list",
    "sudo gcloud run services list",
    "env gcloud run services list",
    "bash -c 'gcloud run services delete s'",
    'sh -c "gcloud functions delete f"',
    "echo gcloud | xargs gcloud run services delete",
    "/usr/local/bin/gcloud run services list",
    "./gcloud run services list",
    "g\\cloud run services delete s",
    "gcloud run services list > out.txt",
    "gcloud run services list 2>/dev/null",
    "echo gcloud run services delete s",
    "grep -n probe .claude/hooks/gcloud-readonly.py",
]

# The hook must not approve these; they reach the normal permission prompt.
NOT_APPROVED = [
    "gcloud run services list | head",
    "gcloud run services list ; rm -rf x",
    "gcloud run services list && rm -rf x",
    "gcloud run services describe s\nrm -rf x",
    # An escaped backslash before the newline does not continue the line.
    "gcloud functions list \\\\\nrm -rf x",
    # Backslash, CR, LF: bash ends the command at the LF.
    "gcloud functions list \\\r\nrm -rf x",
    # Deliberate obfuscation is out of scope; it reaches the normal prompt.
    "$'\\x67cloud' functions delete x",
]

# Commands that never mention gcloud pass through untouched.
UNRELATED = ["ls -la", "git status", "npm test", "echo hello"]


class ReadOnlyGcloudHookTest(unittest.TestCase):
    def check(self, commands, expected):
        for command in commands:
            with self.subTest(command=command):
                decision, _, stderr = decide(command)
                self.assertEqual(decision, expected, stderr)

    def test_reads_are_approved(self):
        self.check(READS_ALLOWED, ALLOW)

    def test_mutations_are_denied(self):
        self.check(MUTATIONS_DENIED, DENY)

    def test_unlisted_reads_are_denied(self):
        self.check(UNLISTED_DENIED, DENY)

    def test_mutations_hidden_beside_reads_are_denied(self):
        self.check(HIDDEN_DENIED, DENY)

    def test_indirect_gcloud_is_denied(self):
        self.check(INDIRECT_DENIED, DENY)

    def test_mixed_and_obfuscated_commands_get_no_approval(self):
        for command in NOT_APPROVED:
            with self.subTest(command=command):
                decision, code, stderr = decide(command)
                self.assertNotEqual(decision, ALLOW, stderr)
                self.assertIn(code, (0, 2), stderr)

    def test_unrelated_commands_pass_through(self):
        self.check(UNRELATED, PASSTHROUGH)

    def test_denial_explains_the_allowlist(self):
        _, code, stderr = decide("gcloud builds submit")
        self.assertEqual(code, 2)
        self.assertIn("allowlist of read-only commands", stderr)


class HookFailureTest(unittest.TestCase):
    """Any hook failure blocks the tool call instead of letting it through."""

    def test_hook_exception_denies(self):
        with tempfile.TemporaryDirectory() as tmp:
            hooks = Path(tmp, ".claude", "hooks")
            hooks.mkdir(parents=True)
            (hooks / "gcloud-readonly.py").write_text("raise RuntimeError('boom')\n")
            self.assertEqual(decide("ls", project_dir=tmp)[0], DENY)

    def test_missing_hook_script_denies(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(decide("ls", project_dir=tmp)[0], DENY)

    def test_missing_python_denies(self):
        self.assertEqual(decide("ls", path="/nonexistent")[0], DENY)

    def test_malformed_input_denies(self):
        for payload in ["not json", "", json.dumps({"tool_input": {"command": 5}})]:
            with self.subTest(payload=payload):
                self.assertEqual(decide(payload=payload)[0], DENY)


if __name__ == "__main__":
    unittest.main()
