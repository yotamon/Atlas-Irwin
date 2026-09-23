use anyhow::Context;
use std::{
    io::{ErrorKind, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    time::{Duration, Instant},
};
use url::Url;

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserPairingCallback {
    pub pairing_code: String,
}

pub fn connect_url(api_base_url: &str, callback_url: &str, state: &str) -> anyhow::Result<String> {
    let base = Url::parse(api_base_url).context("invalid Ensemblis URL")?;
    let local_dev = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if base.scheme() != "https" && !(local_dev && base.scheme() == "http") {
        anyhow::bail!("Ensemblis requires HTTPS outside localhost development");
    }
    let mut target = base.join("/studio/connect-library-bridge")?;
    target
        .query_pairs_mut()
        .append_pair("callback", callback_url)
        .append_pair("state", state);
    Ok(target.to_string())
}

pub fn bind_callback_listener() -> anyhow::Result<(TcpListener, String)> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    Ok((listener, callback_url(address)))
}

fn callback_url(address: SocketAddr) -> String {
    format!("http://127.0.0.1:{}/callback", address.port())
}

fn read_request(stream: &mut TcpStream) -> anyhow::Result<String> {
    stream.set_read_timeout(Some(CALLBACK_READ_TIMEOUT))?;
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    while bytes.len() < MAX_REQUEST_BYTES {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            Err(error)
                if error.kind() == ErrorKind::WouldBlock || error.kind() == ErrorKind::TimedOut =>
            {
                break;
            }
            Err(error) => return Err(error.into()),
        }
    }
    if bytes.len() >= MAX_REQUEST_BYTES {
        anyhow::bail!("browser authorization callback request is too large");
    }
    String::from_utf8(bytes).context("browser authorization callback is not valid UTF-8")
}

fn parse_callback(request: &str, expected_state: &str) -> anyhow::Result<BrowserPairingCallback> {
    let first_line = request
        .lines()
        .next()
        .context("browser authorization callback is empty")?;
    let mut parts = first_line.split_whitespace();
    if parts.next() != Some("GET") {
        anyhow::bail!("browser authorization callback must use GET");
    }
    let target = parts
        .next()
        .context("browser authorization callback is missing a target")?;
    let url = Url::parse(&format!("http://127.0.0.1{target}"))?;
    if url.path() != "/callback" {
        anyhow::bail!("browser authorization callback path is invalid");
    }
    let mut state = None;
    let mut code = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "state" => state = Some(value.into_owned()),
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        anyhow::bail!("browser authorization state did not match this app session");
    }
    if let Some(error) = error {
        anyhow::bail!("browser authorization was not completed: {error}");
    }
    let pairing_code = code.context("browser authorization did not return a pairing code")?;
    let normalized: String = pairing_code
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect();
    if normalized.len() != 16
        || !pairing_code
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        anyhow::bail!("browser authorization returned an invalid pairing code");
    }
    Ok(BrowserPairingCallback { pairing_code })
}

fn respond(stream: &mut TcpStream, success: bool) {
    let (status, title, message) = if success {
        (
            "200 OK",
            "Connected to Ensemblis",
            "This computer is connected. You can close this tab and return to Ensemblis.",
        )
    } else {
        (
            "400 Bad Request",
            "Connection could not be completed",
            "Return to the Ensemblis app and try connecting again.",
        )
    };
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b10;color:#f7f5ef;font:16px/1.55 system-ui,sans-serif}}main{{max-width:520px;padding:48px;text-align:center}}h1{{font-size:2rem;letter-spacing:-.03em}}p{{color:#aeb7c5}}</style></head><body><main><h1>{title}</h1><p>{message}</p></main><script>history.replaceState(null,'','/connected')</script></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub fn wait_for_callback<T>(
    listener: TcpListener,
    expected_state: &str,
    complete: impl FnOnce(&str) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let started = Instant::now();
    while started.elapsed() < CALLBACK_TIMEOUT {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let callback = match read_request(&mut stream)
                    .and_then(|request| parse_callback(&request, expected_state))
                {
                    Ok(callback) => callback,
                    Err(error) => {
                        respond(&mut stream, false);
                        return Err(error);
                    }
                };
                let result = complete(&callback.pairing_code);
                respond(&mut stream, result.is_ok());
                return result;
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.into()),
        }
    }
    anyhow::bail!("browser authorization timed out; try connecting again")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_url_keeps_callback_and_state_scoped_to_ensemblis() {
        let url = connect_url(
            "https://atlasirwin.com",
            "http://127.0.0.1:43123/callback",
            "state-123",
        )
        .unwrap();
        let parsed = Url::parse(&url).unwrap();
        assert_eq!(parsed.scheme(), "https");
        assert_eq!(parsed.host_str(), Some("atlasirwin.com"));
        assert_eq!(parsed.path(), "/studio/connect-library-bridge");
        let query = parsed
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            query.get("state").map(|value| value.as_ref()),
            Some("state-123")
        );
        assert_eq!(
            query.get("callback").map(|value| value.as_ref()),
            Some("http://127.0.0.1:43123/callback")
        );
    }

    #[test]
    fn callback_rejects_mismatched_state() {
        let request =
            "GET /callback?state=wrong&code=ABCDEFGHIJKLMNOP HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert!(parse_callback(request, "right").is_err());
    }

    #[test]
    fn callback_accepts_one_time_code() {
        let request = "GET /callback?state=right&code=ABCD-EFGH-IJKL-MNOP HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let result = parse_callback(request, "right").unwrap();
        assert_eq!(result.pairing_code, "ABCD-EFGH-IJKL-MNOP");
    }
}
