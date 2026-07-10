use tokio::net::UdpSocket;
use std::sync::Arc;
use tokio::sync::mpsc;
use std::net::SocketAddr;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TelemetryPacket {
    pub node_id: u32,
    pub timestamp_ns: u64,
    pub clock_drift_ns: i64,
    pub execution_jitter_ns: u64,
}

pub struct CollectorConfig {
    pub listen_addr: String,
    pub channel_capacity: usize,
    pub buffer_size: usize,
}

pub struct Collector {
    config: CollectorConfig,
}

impl Collector {
    pub fn new(config: CollectorConfig) -> Self {
        Self { config }
    }

    pub async fn start(
        self,
        tx: mpsc::Sender<TelemetryPacket>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let addr: SocketAddr = self.config.listen_addr.parse()?;
        let socket = Arc::new(UdpSocket::bind(addr).await?);
        let mut buf = vec![0u8; self.config.buffer_size];

        println!("Chronos Drift Collector listening on UDP {}", addr);

        loop {
            let (len, _remote_addr) = socket.recv_from(&mut buf).await?;
            let data = buf[..len].to_vec();
            let tx_clone = tx.clone();

            tokio::spawn(async move {
                match bincode::deserialize::<TelemetryPacket>(&data) {
                    Ok(packet) => {
                        if let Err(e) = tx_clone.send(packet).await {
                            eprintln!("Failed to enqueue telemetry packet: {}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to deserialize telemetry packet: {}", e);
                    }
                }
            });
        }
    }
}

pub async fn run_telemetry_pipeline(
    config: CollectorConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (tx, mut rx) = mpsc::channel::<TelemetryPacket>(config.channel_capacity);
    let collector = Collector::new(config);

    tokio::spawn(async move {
        while let Some(packet) = rx.recv().await {
            // In a full production system, this would batch packets and 
            // flush them to a time-series database or forward to the Zig-optimized parser.
            // For now, we simulate the sink.
            if packet.clock_drift_ns.abs() > 1_000_000 {
                println!(
                    "High Drift Detected: Node {} | Drift: {}ns | Jitter: {}ns",
                    packet.node_id, packet.clock_drift_ns, packet.execution_jitter_ns
                );
            }
        }
    });

    collector.start(tx).await
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = CollectorConfig {
        listen_addr: "0.0.0.0:9000".to_string(),
        channel_capacity: 100_000,
        buffer_size: 1024,
    };

    run_telemetry_pipeline(config).await
}