# Temporary release script to assist in the manual publising of the 0.1.0 gemini cli app

# rebase to release branch
git fetch origin release:release
git rebase release

# set environment variables to point to public docker image registry
export SANDBOX_IMAGE_REGISTRY=us-docker.pkg.dev/gemini-code-dev/gemini-cli
export SANDBOX_IMAGE_NAME=sandbox

# publish app
npm run publish:release
