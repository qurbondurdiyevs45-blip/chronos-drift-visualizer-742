package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type AgentStatus string

const (
	StatusOnline  AgentStatus = "ONLINE"
	StatusOffline AgentStatus = "OFFLINE"
	StatusDrifted AgentStatus = "DRIFTED"
)

type DriftReport struct {
	AgentID   string    `json:"agent_id"`
	LocalTime int64     `json:"local_time"`
	OffsetNs  int64     `json:"offset_ns"`
	JitterUs  float64   `json:"jitter_us"`
	Timestamp time.Time `json:"timestamp"`
}

type AgentMetadata struct {
	ID         string      `json:"id"`
	IP         string      `json:"ip"`
	LastSeen   time.Time   `json:"last_seen"`
	Status     AgentStatus `json:"status"`
	ClockDrift int64       `json:"clock_drift"`
}

type Orchestrator struct {
	mu      sync.RWMutex
	agents  map[string]*AgentMetadata
	upgrader websocket.Upgrader
}

func NewOrchestrator() *Orchestrator {
	return &Orchestrator{
		agents: make(map[string]*AgentMetadata),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (o *Orchestrator) HandleAgentHeartbeat(w http.ResponseWriter, r *http.Request) {
	conn, err := o.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var report DriftReport
		if err := json.Unmarshal(message, &report); err != nil {
			log.Printf("Invalid report format: %v", err)
			continue
		}

		o.mu.Lock()
		o.agents[report.AgentID] = &AgentMetadata{
			ID:         report.AgentID,
			IP:         r.RemoteAddr,
			LastSeen:   time.Now(),
			Status:     StatusOnline,
			ClockDrift: report.OffsetNs,
		}
		o.mu.Unlock()

		// Send Sync Signal (PTP-lite)
		syncPayload := map[string]interface{}{
			"server_time": time.Now().UnixNano(),
			"ref_id":      "CHRONOS_MASTER",
		}
		conn.WriteJSON(syncPayload)
	}
}

func (o *Orchestrator) GetAgents(w http.ResponseWriter, r *http.Request) {
	o.mu.RLock()
	defer o.mu.RUnlock()

	agents := make([]AgentMetadata, 0, len(o.agents))
	for _, a := range o.agents {
		agents = append(agents, *a)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agents)
}

func (o *Orchestrator) MonitorHealth(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-ticker.C:
			o.mu.Lock()
			now := time.Now()
			for id, agent := range o.agents {
				if now.Sub(agent.LastSeen) > 15*time.Second {
					agent.Status = StatusOffline
				}
				if agent.ClockDrift > 500000 || agent.ClockDrift < -500000 {
					if agent.Status != StatusOffline {
						agent.Status = StatusDrifted
					}
				}
			}
			o.mu.Unlock()
		case <-ctx.Done():
			return
		}
	}
}

func main() {
	orchestrator := NewOrchestrator()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go orchestrator.MonitorHealth(ctx)

	http.HandleFunc("/ws/heartbeat", orchestrator.HandleAgentHeartbeat)
	http.HandleFunc("/api/agents", orchestrator.GetAgents)
	
	// Health check for load balancers
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	port := ":8080"
	fmt.Printf("Chronos Drift Orchestrator starting on %s...\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}