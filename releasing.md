# Releasing mjolnir

1. Create a new branch and edit the `version` variable of `package.json` to reflect the new version
2. Once that branch has been merged, switch back to the main branch and pull in the new changes
3. Tag the new version, ie `git tag -s vX.Y.Z` (where vX.Y.Z is the new version), and push the tag
4. Once the tag has been pushed, draft a new release on github: https://github.com/matrix-org/mjolnir/releases/new,
using the Generate release notes button to automatically create the release notes/changelog
5. Double-check that everything is correct and make any changes as necessary, then publish the release
6. Publishing the release should kick off a Github Action to build and push the release to Dockerhub -
verify that this did occur successfully

