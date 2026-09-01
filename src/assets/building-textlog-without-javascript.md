# Building textlog without JavaScript

> ai;dr — This post has been enhanced with AI.

When I started building [textlog](https://textlog.cc), I chose a constraint: HTML/CSS only. No JavaScript.

That led to an apparent contradiction: React without React.

I chose React because its best idea is simple: `UI = f(state)`. Given the current user, request and data, components describe the document that should exist. That is a good model on the server too; it does not require a client runtime.

A request comes in, we get the state, React renders the UI once, and we send the resulting HTML. React never reaches the browser. There is no hydration and no second application waking up afterwards. The HTML arrives, and that's the page.

The constraint quickly became a useful way to think. Instead of reaching first for client state and event handlers, I started with what the browser already does.

Links navigate. Forms change things. URLs hold state. Radio buttons make choices. `<details>` reveals content. Inputs validate themselves. Back, forward and refresh already work.

A poll can be a form. A filter can live in the URL. Pagination can be links. An edit can be a submission followed by a redirect. New ideas do not automatically need new pieces of client state; they can become documents, links and requests.

And /clarity/ became a feature. Every page arrives complete. Every meaningful place has an address. The browser remains in charge of navigation.

The server side stays just as direct. It already knows who you are, what you can see and what the database contains. When something changes, it changes the state and renders the next page. The whole loop can be this small:

```ts
app.post('/follow/:handle', async context => {
  await follow(context.user, context.params.handle)
  return context.redirect(`/u/${context.params.handle}`, 303)
})
```

The response is not an instruction for a client application to update itself. It is simply the next document.

This also keeps performance easy to reason about. There is no application bundle to parse, nothing to hydrate and no framework runtime waiting after the page loads. The browser receives a small HTML page and starts rendering it.

Some browser features genuinely require JavaScript. Push notifications are one example. For those cases, textlog uses it deliberately and in isolation. The goal is not purity; JavaScript is allowed when it has a clear reason to be there.

That distinction shapes the personality of textlog. When an interaction is not free, you ask better questions: does this need to update live, float above the page or demand attention? Often, it doesn't.

I would not build every application this way. Rich clients have their place. But much of the web is still people reading, following links, filling in forms and changing state on a server—and HTML is remarkably good at all of it.

Textlog is React on the server, HTML in the browser, forms for change, URLs for memory, and a little JavaScript where the browser actually demands it.

The foundations of the web are not a limitation. They are an invitation to build with intention.
