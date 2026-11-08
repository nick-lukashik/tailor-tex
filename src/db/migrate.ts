// Kubernetes: the api component of gitops runs `node dist/db/migrate.js` as a
// Job before every rollout. This service has no database, so it only says so.
console.log(
    JSON.stringify({
        level: 'info',
        time: new Date().toISOString(),
        msg: 'no migrations',
        service: 'tailor-tex',
    }),
)
