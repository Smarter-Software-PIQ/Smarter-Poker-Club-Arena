# Scope the existing post-deploy keep-game-pages acceptance journey

The existing run-post-deploy-e2e event accepts one additional closed payload: {"keep_game_pages":true}. It selects only the unchanged tournament Details/spectator lobby tab/explicit Close Lobby journey in Chromium and WebKit. Arbitrary selectors, refs, engine pins and mixed modes are refused. The original client_navigation:true three-case mode remains unchanged.

The common client job supplies its existing published-source alignment, reserved synthetic staff identity, installed cleanup safety, serialization, exact release window and unconditional account cleanup. No publisher, workflow, observer, engine gate or product-code change is added. Each selected case must pass exactly once, without skip or retry. The existing 120-second case budget, native gestures and all route/page-preservation assertions remain intact.

This is a scoped diagnosis and acceptance route, not a root-cause fix or a replacement whole-client certificate. Previous run41244580512 remains failed (693/700 pass). Retained traces show an uncompleted Chromium Details input and a roughly63-second WebKit first tab-menu gesture; the WebKit context closed at the overall deadline before its final Close Lobby gesture. The input-delay cause remains unknown. No production dispatch was performed by this source owner.
