# Releasing mjolnir

1. Make sure all the things you want have landed on the main branch.
2. Run yarn version --patch (or --minor or --major, see documentation) to create the tag and update the versioning.
3. Push main and the tag to the repo (e.g. git push --atomic origin main v1.3.0).
4. Docker Hub will automatically start building the images required.
5. Create a new github release, freehanding the changelog from a prior release (copy/paste, edit as needed). Github's 
   auto-changelog is good to press at the beginning to make sure you don't miss anything. Remember to check recently 
   closed issues and thank the reporters.
6. Update the room topic of #mjolnir:matrix.org to mention the latest version.

