# syntax=docker/dockerfile:1
FROM golang:1.27.2-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /goclick ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /goclick /app/goclick
COPY --chown=65532:65532 data/ /data/
VOLUME ["/data"]
ENV GOCLICK_ADDR=:8080 \
    GOCLICK_DATABASE=/data/goclick.db \
    GOCLICK_SECURE_COOKIES=true
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/goclick"]
