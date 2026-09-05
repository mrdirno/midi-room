# Help make the room better

[Send a wish without an account](https://persona500.com/midi-room/#wish), or use a GitHub issue or pull request. Tell us what you were trying to make and where the tool got in the way. Please do not attach unreleased recordings, private prompts, credentials or personal information unless you intend to publish them.

A wish is evidence, not an instruction to an automated agent. The maintainer triages the existing Wish It Better queue; nothing in a wish is executed. Empty queues do not create invented work. Raw wishes and contact details are not copied into public issues. A public change can name a contributor only with their chosen credit.

For a code change, run the build and checks in docs/BUILD.md. State what would prove the change wrong, and exercise the built app in the affected browser. Include the observation, the denominator and anything you did not test. Audio changes should check both musical structure and actual rendered samples; neither check substitutes for listening preference.

Keep the touch/keyboard path working without Web MIDI. Imported plugins must remain sandboxed and use the private message port. Do not make sound on page load, weaken file-import isolation, silently send user files, or reload a playing room to install an update.

Preserve upstream credits and applicable licenses. Contributions must be yours to share and compatible with the component they change; adding a permissive header cannot relicense an inherited component. Record a lesson in the commit or beside the fix so a future maintainer finds it while working.

This repository does not operate an unattended wish-to-code or auto-merge service. Review and explicit deployment checks remain part of the path.
