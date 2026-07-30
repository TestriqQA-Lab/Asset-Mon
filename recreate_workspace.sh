#!/usr/bin/env bash
curl -s -X POST "http://localhost:4000/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"slug":"s4demo10679","workspaceName":"Demo Workspace","email":"admin@s4demo10679.test","password":"DemoPass12","firstName":"Admin","lastName":"User"}'
