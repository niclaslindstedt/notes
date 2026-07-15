//! Reachability: LAN IP detection, UPnP port-mapping, and mDNS advertising.
//!
//! By default the daemon maps an external port via UPnP so a home box is
//! reachable from anywhere — which **exposes it to the internet**, hence the
//! loud warning at startup and the `--no-upnp` escape hatch. Either way it also
//! advertises on mDNS so devices on the same LAN can discover it, and reports a
//! LAN address for the QR. All of this is best-effort: a router without UPnP,
//! or a network without mDNS, degrades to "LAN-only" rather than failing the
//! daemon.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceInfo};

/// What we managed to make reachable, held for the process lifetime.
pub struct Reachability {
    /// `host:port` on the LAN (or loopback), for the QR.
    pub lan: Option<String>,
    /// `host:port` from outside, present only if UPnP mapped a port.
    pub wan: Option<String>,
    /// Kept alive so the mDNS registration isn't dropped.
    _mdns: Option<ServiceDaemon>,
}

/// Best-effort LAN IPv4 of this machine.
pub fn lan_ip() -> Option<IpAddr> {
    local_ip_address::local_ip().ok()
}

/// Set reachability up for `port`. `no_upnp` skips the internet-facing mapping.
pub async fn setup(port: u16, name: &str, pin: &str, no_upnp: bool) -> Reachability {
    let lan_ip = lan_ip();
    let lan = lan_ip.map(|ip| format!("{ip}:{port}"));

    let wan = if no_upnp {
        None
    } else {
        match map_upnp(port).await {
            Ok(ip) => Some(format!("{ip}:{port}")),
            Err(err) => {
                tracing::warn!("UPnP mapping failed ({err}); continuing LAN-only");
                None
            }
        }
    };

    let mdns = advertise(name, pin, lan_ip, port).unwrap_or_else(|err| {
        tracing::warn!("mDNS advertise failed ({err}); LAN discovery unavailable");
        None
    });

    Reachability {
        lan,
        wan,
        _mdns: mdns,
    }
}

/// Map `port` on the gateway and return the external IP. Renews the lease in the
/// background so the mapping survives past its TTL.
async fn map_upnp(port: u16) -> anyhow::Result<IpAddr> {
    use igd_next::aio::tokio as igd_tokio;
    use igd_next::{PortMappingProtocol, SearchOptions};

    let lan_ip = lan_ip().ok_or_else(|| anyhow::anyhow!("no LAN IP to map to"))?;
    let local = SocketAddr::new(lan_ip, port);

    let gateway = igd_tokio::search_gateway(SearchOptions::default()).await?;
    let lease = 3600u32;
    gateway
        .add_port(PortMappingProtocol::TCP, port, local, lease, "notesd")
        .await?;
    let external = gateway.get_external_ip().await?;

    // Renew a little before the lease expires, indefinitely, so an always-on
    // daemon stays reachable.
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs((lease as u64) * 3 / 4)).await;
            if let Err(err) = gateway
                .add_port(PortMappingProtocol::TCP, port, local, lease, "notesd")
                .await
            {
                tracing::warn!("UPnP lease renewal failed: {err}");
            }
        }
    });

    Ok(external)
}

/// Register the daemon as `_notesd._tcp.local.`, carrying the SPKI pin in a TXT
/// record so a discovering client can pin without a QR.
fn advertise(
    name: &str,
    pin: &str,
    ip: Option<IpAddr>,
    port: u16,
) -> anyhow::Result<Option<ServiceDaemon>> {
    let Some(ip) = ip else { return Ok(None) };
    let mdns = ServiceDaemon::new()?;
    let host = format!("{}.local.", sanitize(name));
    let props = [("pin", pin)];
    let info = ServiceInfo::new(
        "_notesd._tcp.local.",
        name,
        &host,
        ip.to_string().as_str(),
        port,
        &props[..],
    )?;
    mdns.register(info)?;
    Ok(Some(mdns))
}

/// mDNS hostnames tolerate a narrow charset — fold anything else to `-`.
fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}
