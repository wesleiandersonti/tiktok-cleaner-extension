# Deployment Guide

This project can be distributed in two ways:

1. Chrome Web Store (recommended for auto-update to end users)
2. Self-hosted update feed (GitHub Releases + update XML, best for managed environments)

## 1) Chrome Web Store (recommended)

Use this when you want reliable auto-update for normal Chrome users.

### First publish
1. Increase `version` in `manifest.json`.
2. Build a zip with extension files (do not include `.git`).
3. Go to Chrome Web Store Developer Dashboard.
4. Create item and upload zip.
5. Set visibility (`Unlisted` is usually best for private sharing).
6. Publish.

### Next updates
1. Change code.
2. Increase `version` in `manifest.json`.
3. Upload new zip in the same Web Store item.
4. Publish update.

Chrome will update installed users automatically.

## 2) Self-hosted update feed (GitHub)

Important: this flow is best for enterprise/managed installs. For consumer Chrome installs, Web Store remains the most reliable path.

### 2.1 Keep a fixed signing key
1. Generate/store a `.pem` key once.
2. Never rotate the key unless you intentionally want a new extension ID.
3. Never commit the `.pem` to git.

### 2.2 Pack CRX
Use Chrome/Chromium pack command with your extension folder and key.

Windows example:
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension="C:\path\tiktok-cleaner-extension" --pack-extension-key="C:\secure\tiktok-cleaner.pem"
```

This generates a `.crx` package.

### 2.3 Add update URL in a self-hosted manifest build
For self-hosted distribution, add `update_url` in manifest:

```json
{
  "update_url": "https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/main/release/updates.xml"
}
```

Tip: keep this only in a self-hosted build variant (not the Web Store build).

### 2.4 Host release assets
1. Upload `.crx` to GitHub Releases (public URL).
2. Publish `release/updates.xml` in repo.

This repository already includes:
- `release/updates.xml` (pre-filled with repo URL; replace only extension ID/version as needed)
- `release/updates.xml.example` (generic template)

`release/updates.xml` example:
```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck
      codebase='https://github.com/<owner>/<repo>/releases/download/v0.1.1/tiktok-cleaner-extension.crx'
      version='0.1.1' />
  </app>
</gupdate>
```

### 2.5 Install policy (managed environment)
Use enterprise policy to force-install from update URL.

Windows registry example (concept):
- key: `HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist`
- value: `<extension_id>;https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/main/release/updates.xml`

## Release checklist
- bump `manifest.json` version
- update release notes
- publish Web Store package
- publish GitHub release assets (`.crx` + `updates.xml` update)
- validate install/update in a clean profile
