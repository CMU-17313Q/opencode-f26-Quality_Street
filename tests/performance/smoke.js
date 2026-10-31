import http from "k6/http"
import { check, sleep } from "k6"

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:4096"

// Read-only endpoints only, so the load test never changes server state.
const ENDPOINTS = ["/global/health", "/api/health", "/path", "/project/current", "/"]

export const options = {
  vus: 3,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
    checks: ["rate>0.99"],
  },
}

export default function () {
  for (const path of ENDPOINTS) {
    const response = http.get(`${BASE_URL}${path}`, { tags: { endpoint: path } })
    check(response, { [`${path} returns 200`]: (r) => r.status === 200 })
  }
  sleep(1)
}
