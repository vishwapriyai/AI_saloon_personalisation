# Git Commands – Bitbucket & GitHub

## Repository Details
- **Bitbucket:** `origin`
- **Bitbucket Working Branch:** `branch_vish`
- **Bitbucket Upstream Branch:** `submaster`
- **GitHub:** `github`
- **GitHub Branch:** `main`

## 1. Start Working

```bash
# Switch to your branch
git checkout branch_vish

# Pull latest changes from Bitbucket
git pull origin submaster
```

## 2. Commit Your Changes

```bash
git add .
git commit -m "Updated project"
```

## 3. Push to Bitbucket

```bash
git push origin branch_vish
```

## 4. Push to GitHub

```bash
git push github main
```

## 5. Useful Commands

```bash
# Check status
git status

# Check current branch
git branch

# Check remote repositories
git remote -v

# Fetch latest changes
git fetch origin
```

## Daily Workflow

```bash
git checkout branch_vish
git pull origin submaster
git add .
git commit -m "Updated project"
git push origin branch_vish
git push github branch_vish:main
```
