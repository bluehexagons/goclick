# syntax=docker/dockerfile:1
FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /goclick ./cmd/server
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /goclick-admin ./cmd/admin

FROM gcr.io/distroless/static-debian13:nonroot
WORKDIR /app
COPY --from=build /goclick /app/goclick
COPY --from=build /goclick-admin /app/goclick-admin
COPY --chown=65532:65532 data/ /data/
VOLUME ["/data"]
ENV GOCLICK_ADDR=:8080 \
    GOCLICK_DATABASE=/data/goclick.db \
    GOCLICK_SECURE_COOKIES=true
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/goclick"]
