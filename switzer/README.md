# Installing Webfonts
Follow these simple Steps.

## 1.
Put `switzer/` Folder into a Folder called `fonts/`.

## 2.
Put `switzer.css` into your `css/` Folder.

## 3. (Optional)
You may adapt the `url('path')` in `switzer.css` depends on your Website Filesystem.

## 4.
Import `switzer.css` at the top of you main Stylesheet.

```
@import url('switzer.css');
```

## 5.
You are now ready to use the following Rules in your CSS to specify each Font Style:
```
font-family: Switzer-Thin;
font-family: Switzer-ThinItalic;
font-family: Switzer-Extralight;
font-family: Switzer-ExtralightItalic;
font-family: Switzer-Light;
font-family: Switzer-LightItalic;
font-family: Switzer-Regular;
font-family: Switzer-Italic;
font-family: Switzer-Medium;
font-family: Switzer-MediumItalic;
font-family: Switzer-Semibold;
font-family: Switzer-SemiboldItalic;
font-family: Switzer-Bold;
font-family: Switzer-BoldItalic;
font-family: Switzer-Extrabold;
font-family: Switzer-ExtraboldItalic;
font-family: Switzer-Black;
font-family: Switzer-BlackItalic;
font-family: Switzer-Variable;
font-family: Switzer-VariableItalic;

```
## 6. (Optional)
Use `font-variation-settings` rule to controll axes of variable fonts:
wght 400.0

Available axes:
'wght' (range from 100.0 to 900.0

