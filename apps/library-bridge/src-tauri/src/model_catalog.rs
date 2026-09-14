use crate::{db::BridgeDb, models::ModelDescriptor};
use anyhow::Context;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Duration;
use url::Url;

const MODEL_CATALOG_VERSION: &str = "ensemblis.model-catalog.v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogResponse {
    version: String,
    models: Vec<ModelDescriptor>,
}

pub fn fetch_catalog(db: &BridgeDb) -> anyhow::Result<Vec<ModelDescriptor>> {
    let api_base = db
        .get_setting("api_base_url")?
        .context("Bridge API is not configured")?;
    let mut url = Url::parse(&api_base).context("invalid Ensemblis API URL")?;
    let local_dev = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(local_dev && url.scheme() == "http") {
        anyhow::bail!("model catalog requires HTTPS outside localhost development");
    }
    url = url.join("/api/runtime/models")?;
    url.query_pairs_mut()
        .append_pair("platform", std::env::consts::OS)
        .append_pair("architecture", std::env::consts::ARCH);
    let response = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Ensemblis-Library-Bridge/0.1")
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;
    let catalog: CatalogResponse = response.json()?;
    if catalog.version != MODEL_CATALOG_VERSION || catalog.models.len() > 200 {
        anyhow::bail!("model catalog contract is invalid");
    }
    Ok(catalog.models)
}
