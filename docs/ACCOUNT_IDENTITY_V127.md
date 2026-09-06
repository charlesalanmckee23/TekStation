# TekStation v127 — persistent account identity

- Main hero account control now persists after the Data Vault closes.
- Signed-in state shows the account name derived from the locally stored email address plus cloud-sync status.
- A separate 44px Sign out control is shown only while signed in.
- The email address is stored only in this device\'s IndexedDB account metadata for display; D1 continues to store only the email hash.
- Registration/sign-in/recovery/encrypted vault flows are unchanged.
