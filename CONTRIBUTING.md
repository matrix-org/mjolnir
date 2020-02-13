# Contributing code to Matrix

Everyone is welcome to contribute code to Matrix
(https://github.com/matrix-org), provided that they are willing to license
their contributions under the same license as the project itself. We follow a
simple 'inbound=outbound' model for contributions: the act of submitting an
'inbound' contribution means that the contributor agrees to license the code
under the same terms as the project's overall 'outbound' license - in our
case, this is almost always Apache Software License v2 (see [LICENSE](LICENSE)).

## How to contribute

The preferred and easiest way to contribute changes to Matrix is to fork the
relevant project on github, and then [create a pull request](
https://help.github.com/articles/using-pull-requests/) to ask us to pull
your changes into our repo.

We use [Buildkite](https://buildkite.com/matrix-dot-org/mjolnir) for continuous
integration. If your change breaks the build, this will be shown in GitHub, so
please keep an eye on the pull request for feedback.

To run unit tests in a local development environment, you can use `yarn test`
and `yarn lint`.

## Code style

All Matrix projects have a well-defined code-style - and sometimes we've even
got as far as documenting it... Mjolnir's code style is a relatively standard
TypeScript project - run `yarn lint` to see how your code fairs.

Before pushing new changes, ensure they don't produce linting errors.

Please ensure your changes match the cosmetic style of the existing project,
and **never** mix cosmetic and functional changes in the same commit, as it
makes it horribly hard to review otherwise.

## Sign off

In order to have a concrete record that your contribution is intentional
and you agree to license it under the same terms as the project's license, we've adopted the
same lightweight approach that the Linux Kernel
[submitting patches process](
https://www.kernel.org/doc/html/latest/process/submitting-patches.html#sign-your-work-the-developer-s-certificate-of-origin>),
[Docker](https://github.com/docker/docker/blob/master/CONTRIBUTING.md), and many other
projects use: the DCO (Developer Certificate of Origin:
http://developercertificate.org/). This is a simple declaration that you wrote
the contribution or otherwise have the right to contribute it to Matrix:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
660 York Street, Suite 102,
San Francisco, CA 94110 USA

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

If you agree to this for your contribution, then all that's needed is to
include the line in your commit or pull request comment:

```
Signed-off-by: Your Name <your@email.example.org>
```

We accept contributions under a legally identifiable name, such as
your name on government documentation or common-law names (names
claimed by legitimate usage or repute). Unfortunately, we cannot
accept anonymous contributions at this time.

Git allows you to add this signoff automatically when using the `-s`
flag to `git commit`, which uses the name and email set in your
`user.name` and `user.email` git configs.

## Conclusion

That's it! Matrix is a very open and collaborative project as you might expect
given our obsession with open communication. If we're going to successfully
matrix together all the fragmented communication technologies out there we are
reliant on contributions and collaboration from the community to do so. So
please get involved - and we hope you have as much fun hacking on Matrix as we
do!
