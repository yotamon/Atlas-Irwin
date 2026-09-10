use keyring::Entry;

const SERVICE: &str = "com.ensemblis.library-bridge";
const USERNAME: &str = "device-credential";

fn entry() -> anyhow::Result<Entry> {
    Ok(Entry::new(SERVICE, USERNAME)?)
}

pub fn store_device_credential(value: &str) -> anyhow::Result<()> {
    entry()?.set_password(value)?;
    Ok(())
}

pub fn device_credential() -> anyhow::Result<Option<String>> {
    match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn clear_device_credential() -> anyhow::Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}
