/* This function is triggered by a PUT request to the /upload endpoint from scripts.gojs.
   It uploads the file to "media-purgatory" R2 bucket in Cloudflare
   and triggers GitHub Actions to create/update PR that will add the file to the media repo.

   It requires `x-file-name` header to be set with the file name, which is used as the key in the bucket.
   Example key value: "People/John Doe.jpg"

   Function expects following environment variables:
   `MEDIA` – CloudFlare binding to R2 bucket
   `GITHUB_REPO` (optional) – GitHub "media" repository
   `GHP_TOKEN` (optional) – GitHub Private Token for triggering GitHub Actions for media repository
*/
export async function onRequest(context) {
  try {
    switch (context.request.method) {
      case "PUT":
        const key = decodeURIComponent(
          context.request.headers.get("x-file-name"),
        );
        if (!key) {
          return new Response(
            JSON.stringify({ error: "Missing x-file-name header" }),
            { status: 400 },
          );
        }

        if (context.env.MEDIA) {
          await context.env.MEDIA.put(key, context.request.body);
        } else {
          // send a POST request with body to local server
          var uploaderResponse = await fetch("http://localhost:8780/upload", {
            method: "POST",
            body: context.request.body,
            headers: {
              "x-file-name": key,
            },
          });
          if (uploaderResponse.status !== 201) {
            const text = await response.text();
            throw new Error(
              `Local server failed with status code ${response.status}: ${text}`,
            );
          }
        }

        if (!context.env.GHP_TOKEN || !context.env.GITHUB_REPO) {
          return new Response(
            JSON.stringify({
              status: "ok",
              key: key,
              actions_triggered: false
            }), {
              status: 200,
            }
          );
        }

        const response = await fetch(
          `https://api.github.com/repos/${context.env.GITHUB_REPO}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${context.env.GHP_TOKEN}`,
              Accept: "application/vnd.github.everest-preview+json",
              "Content-Type": "application/json",
              "User-Agent": "alsosee/finder/1.0.0 (CloudFlare Pages Function)",
            },
            body: JSON.stringify({
              event_type: "pull",
              client_payload: {
                path: key,
                trigger: "upload",
              },
            }),
          },
        );

        if (response.status !== 204) {
          const text = await response.text();
          console.log(response.headers);
          console.log(text);
          throw new Error(
            `GitHub API failed with status code ${response.status}`,
          );
        }

        return new Response(JSON.stringify({ status: "ok", key: key }), {
          status: 200,
        });

      default:
        return new Response(
          JSON.stringify({
            error: {
              message: "Method Not Allowed",
            },
          }),
          {
            status: 405,
            headers: {
              Allow: "PUT",
              XError: "Method " + context.request.method + " is not allowed",
            },
          },
        );
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.stack || err }), {
      status: 500,
    });
  }
}
