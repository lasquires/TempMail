# tempMail for GitHub Pages

A static, browser-only disposable inbox. Each tab creates its own Mail.gw account, keeps credentials in session storage, and attempts to delete the remote account after ten minutes or when **Destroy now** is selected.

## Publish

1. Create a GitHub repository and upload all files from this package.
2. Keep the default branch named `main`.
3. In **Settings → Pages**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for “Deploy tempMail to GitHub Pages” to finish.

It works both as a project site (`username.github.io/repository/`) and a user site (`username.github.io`).

## Privacy and limitations

- The webpage is public. An obscure URL is not access control.
- Each browser tab has a separate random inbox and credentials.
- Credentials are stored only in `sessionStorage`, not committed to GitHub.
- Closing the tab clears local credentials, but browsers cannot reliably finish a network deletion while closing. Use **Destroy now** when possible.
- The site depends on Mail.gw permitting direct requests from the browser. If Mail.gw changes its API or CORS policy, a small backend will be required.
- Do not use disposable email for sensitive, medical, financial, identity, or password-recovery messages.

## Local development

```bash
npm install
npm run dev
```

To verify the exact static Pages output:

```bash
npx next build
```

The generated site appears in `out/`.
