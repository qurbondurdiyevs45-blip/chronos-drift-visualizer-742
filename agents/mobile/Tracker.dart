import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class DriftPoint {
  final DateTime timestamp;
  final double jitterMs;
  final double driftUs;
  final String serviceId;

  DriftPoint({
    required this.timestamp,
    required this.jitterMs,
    required this.driftUs,
    required this.serviceId,
  });

  factory DriftPoint.fromJson(Map<String, dynamic> json) {
    return DriftPoint(
      timestamp: DateTime.parse(json['timestamp']),
      jitterMs: json['jitter_ms'].toDouble(),
      driftUs: json['drift_us'].toDouble(),
      serviceId: json['service_id'],
    );
  }
}

class ChronosTracker extends ChangeNotifier {
  final String apiEndpoint;
  final String authToken;
  
  List<DriftPoint> _history = [];
  bool _isPolling = false;
  Timer? _timer;
  double _currentClockSkew = 0.0;
  
  ChronosTracker({
    required this.apiEndpoint,
    required this.authToken,
  });

  List<DriftPoint> get history => List.unmodifiable(_history);
  double get currentClockSkew => _currentClockSkew;
  bool get isPolling => _isPolling;

  void startMonitoring() {
    if (_isPolling) return;
    _isPolling = true;
    _timer = Timer.periodic(const Duration(milliseconds: 1500), (_) => _pollDriftMetrics());
    notifyListeners();
  }

  void stopMonitoring() {
    _timer?.cancel();
    _isPolling = false;
    notifyListeners();
  }

  Future<void> _pollDriftMetrics() async {
    try {
      final response = await http.get(
        Uri.parse('$apiEndpoint/v1/telemetry/drift'),
        headers: {
          'Authorization': 'Bearer $authToken',
          'Content-Type': 'application/json',
          'X-Chronos-Agent': 'Flutter-Mobile-Tracker',
        },
      ).timeout(const Duration(seconds: 3));

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        final List<DriftPoint> newPoints = data.map((item) => DriftPoint.fromJson(item)).toList();
        
        _updateHistory(newPoints);
        _calculateAggregateMetrics();
      }
    } catch (e) {
      debugPrint('Chronos Drift Error: $e');
    }
  }

  void _updateHistory(List<DriftPoint> points) {
    _history.addAll(points);
    // Maintain a rolling window of 1000 points to prevent memory overflow
    if (_history.length > 1000) {
      _history.removeRange(0, _history.length - 1000);
    }
    notifyListeners();
  }

  void _calculateAggregateMetrics() {
    if (_history.isEmpty) return;
    
    // Calculate Weighted Moving Average of clock drift
    double sum = 0;
    for (var i = 0; i < _history.length; i++) {
      sum += _history[i].driftUs;
    }
    _currentClockSkew = sum / _history.length;
  }

  Map<String, double> getJitterHeatmapData() {
    final Map<String, List<double>> serviceGroups = {};
    for (var p in _history) {
      serviceGroups.putIfAbsent(p.serviceId, () => []).add(p.jitterMs);
    }

    final Map<String, double> heatMap = {};
    serviceGroups.forEach((id, values) {
      if (values.isNotEmpty) {
        heatMap[id] = values.reduce((a, b) => a + b) / values.length;
      }
    });

    return heatMap;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}