# Sprint 1 → Main Merge Checklist

## Pre-Merge Validation

### ✅ Code Quality Checks
- [ ] All TypeScript compiles without errors: `npm run build` in each service
- [ ] All tests pass: `npm test` in video-processing-service
- [ ] No lint errors: `npm run lint` in video-processing-service
- [ ] No console.log statements (use structured logger instead)
- [ ] All Firebase functions deployed successfully: `firebase deploy --only functions`

### ✅ Documentation Complete
- [x] Sprint 1 completion summary written (`docs/SPRINT-01-COMPLETION.md`)
- [x] User stories with expanded notes (`docs/features/sprint-01-user-stories-expanded.md`)
- [x] Environment configuration documented (`docs/environment-configuration.md`)
- [x] Smoke test guide with token generation (`docs/smoke-test-guide.md`)
- [x] Pub/Sub IAM audit documented (`docs/pubsub-iam-audit.md`)
- [x] Monitoring setup documented (`docs/monitoring-setup.md`)
- [x] `.env.example` files created for each service

### ✅ Deployment Validated
- [x] Cloud Build triggers created and tested
- [x] Web client deployed to Cloud Run (`cloudscribe-ai` service)
- [x] Video processing service deployed to Cloud Run
- [x] Health endpoints returning 200: `/health` on both services
- [x] Firestore and GCS permissions verified

### ✅ Operational Readiness
- [ ] Smoke test runs successfully end-to-end
- [ ] Cloud Monitoring alerts configured (error rate >2%)
- [ ] Cloud Logging structured logs visible in Cloud Console
- [ ] Cloud Run revision history accessible for rollbacks
- [ ] Uptime tracked for 48 hours with <2% error rate

### ✅ Security & Dependencies
- [x] npm vulnerabilities fixed: `npm audit fix` (form-data, path-to-regexp)
- [ ] No hardcoded secrets in code or commits
- [ ] Service account permissions reviewed and documented
- [ ] CORS settings appropriate for web client domain

---

## Merge Steps

### Step 1: Final Branch Verification

```bash
# On sprint1 branch
git status  # Should show no uncommitted changes

# Pull latest from main
git fetch origin main

# Check for conflicts
git merge --no-commit --no-ff origin/main
# If conflicts, resolve them. Otherwise, abort with:
git merge --abort
```

### Step 2: Create Pull Request

```bash
# Push sprint1 to GitHub (already done, but verify)
git push origin sprint1

# Create PR via GitHub UI:
# - Base: main
# - Compare: sprint1
# - Title: "feat(sprint1): pipeline stabilization with health checks, logging, and CI/CD"
# - Description: Link to docs/SPRINT-01-COMPLETION.md for reviewers
```

### Step 3: Code Review Checklist for Reviewers

Reviewers should verify:
- [ ] All TypeScript changes follow `strict: true` settings
- [ ] Logger usage is consistent (JSON structured logs)
- [ ] Health checks don't introduce new dependencies
- [ ] Pub/Sub error handling preserves deduplication logic
- [ ] Cloud Build triggers won't cause conflicts with existing deployments
- [ ] Documentation is clear and complete

### Step 4: Merge to Main

```bash
# After approval, merge via GitHub UI (use "Squash and merge" to keep history clean)
# OR via CLI:
git checkout main
git pull origin main
git merge --squash origin/sprint1
git commit -m "feat(sprint1): pipeline stabilization

- Add env-driven configuration and health aggregator
- Implement structured JSON logging with jobId correlation
- Add Jest test coverage for Pub/Sub handler and retry logic
- Harden Cloud Build CI/CD with test gates
- Document environment variables, IAM, and monitoring
- Fix web-client Firebase imports

See docs/SPRINT-01-COMPLETION.md for full summary."
git push origin main
```

### Step 5: Cleanup

```bash
# Delete local sprint1 branch
git branch -d sprint1

# Delete remote sprint1 branch
git push origin --delete sprint1
```

---

## Post-Merge Validation

### Verify Main Branch Health

```bash
# Pull latest main
git checkout main
git pull origin main

# Run build & tests
cd video-processing-service && npm run build && npm test
cd ../yt-web-client && npm run build
cd ../api-service/functions && npm run build

# All should pass ✅
```

### Monitor Production

```bash
# Watch Cloud Build
gcloud builds log <build-id> --stream

# Check Cloud Run revisions
gcloud run revisions list --service=video-processing-service --region=us-central1
gcloud run revisions list --service=cloudscribe-ai --region=us-central1

# Monitor errors in Cloud Logging
gcloud logging read "resource.type=cloud_run_revision AND severity=ERROR" --limit=20

# Health check endpoints
curl https://video-processing-service-<hash>.run.app/health
curl https://cloudscribe-ai-<hash>.run.app/health
```

---

## Known Issues / Follow-ups for Sprint 2

1. **Longer-running transcription jobs** may exceed Pub/Sub 600s timeout
   - Solution: Migrate to Cloud Tasks or Firestore-based job locking in Sprint 2

2. **npm vulnerabilities in web-client** (1 low, 1 moderate)
   - Plan to address with Next.js or ESLint updates

3. **Smoke test token generation** needs team training
   - Owner: DevOps to create tutorial and scripts

4. **Cloud Monitoring dashboards** need business metrics
   - Add user uploads/hour, transcription success rate, etc. in Sprint 3

---

## Success Criteria for Sprint 1 Merge

✅ All code builds and tests pass  
✅ All documentation is current and linked  
✅ Smoke test passes end-to-end  
✅ Health endpoints return 200  
✅ Error rate <2% for 48 hours  
✅ No production incidents during merge  
✅ Rollback plan documented and tested  

If all criteria met → **Merge to main** ✨
