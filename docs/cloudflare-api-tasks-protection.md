# Cloudflare Protection for `/api/tasks/*`

Apply these rules in Cloudflare (WAF + Rate Limiting) for production traffic:

## WAF Rules

1. Block non-GET methods for task polling endpoint.
   - Expression example: `http.request.uri.path starts_with "/api/tasks/" and http.request.method ne "GET"`
   - Action: `Block`

2. Challenge requests without task session cookie.
   - Expression example: `http.request.uri.path starts_with "/api/tasks/" and not http.cookie contains "__Host-ft_sid="`
   - Action: `Managed Challenge`

## Rate Limiting

1. Default IP rate limit.
   - Path: `/api/tasks/*`
   - Threshold: `45 requests / minute / IP`
   - Action: `Managed Challenge` or `Block`

2. Stricter IP rate limit when no cookie is present.
   - Path: `/api/tasks/*`
   - Condition: no `__Host-ft_sid` cookie
   - Threshold: `5 requests / minute / IP`
   - Action: `Block`

## Optional Compatibility Rule

If legacy clients still request `/run/detail/*`, duplicate the same WAF and rate-limit rules for that path.
