# La Grande Course du Beaujolais Nouveau

Jeu de course en direct : chaque participant scanne un QR code avec son téléphone,
entre son prénom, choisit une couleur, puis tape le plus vite possible pour faire avancer
son tonneau sur le grand écran. Aucun compte ni application pour les joueurs.

## Contenu du dossier

- `public/index.html` : la page du jeu (écran + téléphone)
- `netlify/functions/api.mjs` : la fonction qui reçoit inscriptions et tapes
- `netlify/lib/game-logic.mjs` : les règles du jeu
- `netlify.toml`, `package.json` : réglages pour Netlify

## Mise en ligne (tout se fait dans le navigateur)

1. **GitHub** : sur github.com, crée un compte gratuit, puis **New repository**
   (nom : `course-beaujolais`, Public ou Private).
2. Dans le dépôt vide : **uploading an existing file**, puis glisse **le contenu** du dossier
   (les dossiers `public`, `netlify` et les fichiers `netlify.toml`, `package.json`).
   Clique **Commit changes**.
3. **Netlify** : **Add new project → Import an existing project → GitHub**,
   autorise l'accès, choisis `course-beaujolais`, puis **Deploy**.
   Ne change aucun réglage, le fichier `netlify.toml` s'en charge.
4. Une à deux minutes plus tard, Netlify donne l'adresse du jeu (`https://….netlify.app`).

## Le jour J

1. Ouvre l'adresse sur le PC relié à l'écran, puis **Plein écran**.
2. La pastille en haut à droite doit être verte : « Prêt ».
3. Les participants scannent le QR code (4G ou wifi, au choix).
4. **Lancer la course**. Ensuite, **Revanche** ou **Retour au salon** pour accueillir de nouveaux joueurs.
5. **↻ Nouvelle partie** génère un nouveau QR code et vide la liste.

## Offre gratuite Netlify

300 crédits par mois. Chaque mise en ligne coûte 15 crédits, une soirée de jeu quelques dizaines.
Évite de multiplier les modifications sur GitHub, car chaque modification relance une mise en ligne.

L'abus d'alcool est dangereux pour la santé, à consommer avec modération.
