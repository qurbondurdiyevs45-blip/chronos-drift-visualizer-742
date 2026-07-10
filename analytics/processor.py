import numpy as np
import json
import sys
from typing import Dict, List, Any
from dataclasses import dataclass

@dataclass
class StatisticsReport:
    mean_drift: float
    median_drift: float
    std_dev: float
    variance: float
    p95_latency: float
    p99_latency: float
    outlier_count: int
    outliers: List[Dict[str, Any]]

class JitterProcessor:
    def __init__(self, zscore_threshold: float = 3.0):
        """
        Initializes the processor for detecting execution jitter and clock drift.
        :param zscore_threshold: The number of standard deviations for outlier classification.
        """
        self.zscore_threshold = zscore_threshold

    def process_telemetry_batch(self, raw_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Analyzes a batch of microservice execution logs to detect timing anomalies.
        Expects a list of dicts with 'service_id', 'timestamp', and 'drift_nanos'.
        """
        if not raw_data:
            return {"error": "Empty telemetry batch"}

        # Extract drift values
        drifts = np.array([item['drift_nanos'] for item in raw_data], dtype=np.float64)
        
        # Calculate central tendencies
        mean_val = np.mean(drifts)
        std_val = np.std(drifts)
        median_val = np.median(drifts)
        
        # Avoid division by zero in perfectly synchronized environments
        if std_val == 0:
            z_scores = np.zeros_like(drifts)
        else:
            z_scores = (drifts - mean_val) / std_val

        # Outlier detection using Z-Score
        outlier_mask = np.abs(z_scores) > self.zscore_threshold
        outlier_indices = np.where(outlier_mask)[0]
        
        outliers = []
        for idx in outlier_indices:
            outliers.append({
                "service_id": raw_data[idx].get("service_id"),
                "timestamp": raw_data[idx].get("timestamp"),
                "drift_value": float(drifts[idx]),
                "z_score": float(z_scores[idx])
            })

        # Calculate Percentiles
        p95 = np.percentile(drifts, 95)
        p99 = np.percentile(drifts, 99)

        report = StatisticsReport(
            mean_drift=float(mean_val),
            median_drift=float(median_val),
            std_dev=float(std_val),
            variance=float(np.var(drifts)),
            p95_latency=float(p95),
            p99_latency=float(p99),
            outlier_count=len(outliers),
            outliers=outliers
        )

        return self._serialize_report(report)

    def _serialize_report(self, report: StatisticsReport) -> Dict[str, Any]:
        return {
            "summary": {
                "mean": report.mean_drift,
                "median": report.median_drift,
                "std_dev": report.std_dev,
                "variance": report.variance,
                "p95": report.p95_latency,
                "p99": report.p99_latency
            },
            "anomalies": {
                "count": report.outlier_count,
                "data_points": report.outliers
            },
            "status": "CRITICAL" if report.p99_latency > (report.mean_drift + 2 * report.std_dev) else "HEALTHY"
        }

def main():
    """
    Stand-alone execution for processing piped JSON data from the Chronos Drift binary parser.
    """
    try:
        input_data = sys.stdin.read()
        if not input_data:
            return

        telemetry = json.loads(input_data)
        
        processor = JitterProcessor(zscore_threshold=2.5)
        analysis_result = processor.process_telemetry_batch(telemetry)
        
        print(json.dumps(analysis_result, indent=2))
        
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input from binary parser"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()