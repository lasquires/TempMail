# tempMail for GitHub Pages

This is a direct static port of the Windows tempMail interface. GitHub Pages serves the original-style HTML/CSS interface, while browser JavaScript replaces the Windows Python localhost server.

## Publish using GitHub's website

1. In your TempMail repository, delete the old Next.js files and folders.
2. Upload `index.html`, `app.css`, and `app.js` from this folder to the repository root.
3. Open **Settings → Pages**.
4. Change **Source** from **GitHub Actions** to **Deploy from a branch**.
5. Choose branch **main**, folder **/(root)**, and click **Save**.
6. Wait a few minutes, then open `https://YOUR-USERNAME.github.io/TempMail/`.

No build process, package manager, hidden files, `.github` directory, or workflow is required.

## Privacy behavior

- Every browser tab keeps its own inbox credentials in `sessionStorage`.
- The webpage source does not contain inbox credentials.
- Each inbox expires after ten minutes and tempMail attempts to delete its Mail.gw account.
- **Advanced → Destroy all inboxes now** deletes all accounts created in the current tab.
- Closing a tab clears its local credentials, but browsers cannot reliably finish a deletion request while closing. Use the destroy control when possible.

Do not use temporary email for medical, financial, identity, or password-recovery messages.
