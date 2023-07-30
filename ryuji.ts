import { readFileSync } from 'fs';

export const SYNTAX_REGEX = /\[\[ [a-zA-Z0-9.:\-_]+ \]\]/g;

export type file_extension = `.${string}`;

export interface ForLoopInfo {
  index: number,
  total: number,
  current: number,
  var_value: any, //value we are looping over
  iter_var_name?: string,
}

export class Renderer {
  templates_dir: string;
  components_dir: string;
  file_extension: file_extension;

  constructor(templates_dir: string, components_dir: string, file_extension: file_extension=".html") {
    this.templates_dir = templates_dir;
    this.components_dir = components_dir;
    this.file_extension = file_extension
  }

  static remove_empty_lines(text: string): string {
    let lines: string[] = text.split("\n");
    let new_lines: string[] = [];
    for (let i=0; i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      new_lines.push(lines[i]);
    }
    return new_lines.join("\n");
  }

  static concat_path(path1: string, path2: string): string {
    if (path1.endsWith("/") && path2.startsWith("/")) {
      return `${path1.slice(0, path1.length-1)}${path2}`;
    } else if ((!path1.endsWith("/") && path2.startsWith("/")) || (path1.endsWith("/") && !path2.startsWith("/"))) {
      return `${path1}${path2}`;
    } else if (!path1.endsWith("/") && !path2.startsWith("/")) {
      return `${path1}/${path2}`;
    }
  }

  static sanitize(non_html: string): string {
    return non_html.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  static check_var_name_legality(var_name: string, dot_allowed: boolean=true) {
    //I try to avoid regex if I can
    let legal_chars: string[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_", "."];
    if (!dot_allowed) legal_chars.pop();
    let legal_var_name: boolean = var_name.toLowerCase().split("").every((char) => legal_chars.includes(char));
    if (!legal_var_name) throw Error(`Variable name "${var_name}" has illegal characters`);
  }

  static get_var(var_name: string, vars?: any): any { //probably a string but guarantee
    if (typeof vars === "undefined") throw Error(`Variable "${var_name}" is undefined`);
    Renderer.check_var_name_legality(var_name);
    let splitted: string[] = var_name.split(".")
    let var_value = vars;
    for (let i=0; i < splitted.length; i++) {
      var_value = var_value?.[splitted[i]];
    }
    if (typeof var_value === "undefined") throw Error(`Variable "${var_name}" is undefined`);
    return var_value;
  }

  render(template_contents: string, vars?: any, recursion_layer: number=0): string {
    let matches = [...template_contents.matchAll(SYNTAX_REGEX)];
    if (matches.length === 0) {
      return template_contents;
    }
    let _iterations: number = 0;
    let rendered: string = template_contents.slice(0, matches[0].index);
    let index: number = 0;
    let for_loops: ForLoopInfo[] = [];
    //let offset: number = 0; //I guess we don't need the offset
    while (true) {
      if (index === matches.length) break;
      if (_iterations > 200) return; //safeguard, todo: remove
      let match = matches[index];
      //[[ content ]]
      let exp_parts = match[0].slice(3, match[0].length-3).split(":");
      if (exp_parts[0] === "component") {
        //we do not want get into an infinite recursion loop with components referring to each other
        if (recursion_layer > 5) throw Error("Components more than 5 layers deep, components may be referencing each other in infinite loop.");
        if (typeof exp_parts[1] !== "string") throw Error("`component:` statement missing component file name afterwards");
        let file_name: string = exp_parts[1];
        rendered += this.render_template(Renderer.concat_path(this.components_dir, `${file_name}${this.file_extension}`), vars, recursion_layer+1);
      } else if (exp_parts[0] === "for") {
        if (for_loops[for_loops.length-1]?.index === index) {
          //for loop already exists, just continue and do nothing
        } else {
          //variables in for loops are not scoped because that would be too much work
          if (typeof exp_parts[1] !== "string") throw Error("`for:` statement missing variable name to loop over afterwards");
          let var_name: string = exp_parts[1];
          let var_value = Renderer.get_var(var_name, vars);
          //set iter variable (optional) (you know, the "post" in "for post in posts")
          //(I don't know what the actual name of that thing is)
          if (typeof exp_parts[2] === "string") {
            let iter_var_name: string = exp_parts[2];
            Renderer.check_var_name_legality(iter_var_name, false);
            vars[iter_var_name] = var_value[0];
          }
          //add to for loops
          for_loops.push({
            index,
            total: var_value.length,
            current: 0,
            var_value,
            iter_var_name: exp_parts[2],
          });
          //make sure thing we are iterating over isn't empty
          if (var_value.length === 0) {
            //skip straight to the endfor
            //todo: remove
            /*let new_index: number = matches.slice(index, matches.length).findIndex((match) => match[0] === "[[ endfor ]]");
            if (new_index === -1) throw Error("for statement missing an `[[ endfor ]]`");
            index += new_index;
            continue;*/
            let sliced = matches.slice(index+1, matches.length);
            let new_index: number;
            let extra_forss: number = 0;
            for (let i=0; i < sliced.length; i++) {
              if (sliced[i][0].startsWith("[[ for:")) {
                extra_forss++;
              } else if (sliced[i][0] === "[[ endfor ]]") {
                if (extra_forss === 0) {
                  new_index = i;
                  break;
                }
                extra_forss--;
              }
            }
            if (typeof new_index === "undefined") throw Error("if statement missing an `[[ endif ]]`");
            index += new_index+1;
            continue;
          }
        }
      } else if (exp_parts[0] === "endfor") {
        //check if for loop is over, if not, go back to for
        let current_loop: ForLoopInfo = for_loops[for_loops.length-1];
        current_loop.current++;
        if (current_loop.current >= current_loop.total) {
          //for loop ended, onwards! oh yeah, also remove the current for loop info
          for_loops.pop();
        } else {
          //update iter var
          if (current_loop.iter_var_name) {
            vars[current_loop.iter_var_name] = current_loop.var_value[current_loop.current];
          }
          //go back to start of for loop index
          index = current_loop.index;
          continue;
        }
      } else if (exp_parts[0] === "if") {
        if (typeof exp_parts[1] !== "string") throw Error("`if:` statement missing variable name afterwards");
        let var_name: string = exp_parts[1];
        let var_value = Renderer.get_var(var_name, vars);
        if (var_value) {
          //yup, nothing here
        } else {
          //skip to the endif
          let sliced = matches.slice(index+1, matches.length);
          let new_index: number;
          let extra_ifs: number = 0;
          for (let i=0; i < sliced.length; i++) {
            if (sliced[i][0].startsWith("[[ if:")) {
              extra_ifs++;
            } else if (sliced[i][0] === "[[ endif ]]") {
              if (extra_ifs === 0) {
                new_index = i;
                break;
              }
              extra_ifs--;
            }
          }
          if (typeof new_index === "undefined") throw Error("if statement missing an `[[ endif ]]`");
          index += new_index+1;
          continue;
        }
      } else if (exp_parts[0] === "endif") {
        //yup, nothing here
      } else { //html:<variable name> or <variable name>
        //variable
        let var_name: string;
        if (exp_parts[0] === "html") {
          if (typeof exp_parts[1] !== "string") throw Error("`html:` statement missing variable name afterwards");
          var_name = exp_parts[1];
        } else {
          var_name = exp_parts[0];
        }
        let var_value = Renderer.get_var(var_name, vars);
        if (exp_parts[0] === "html") {
          //variable but not sanitized
          rendered += var_value;
        } else {
          rendered += Renderer.sanitize(var_value);
        }
        //offset += var_value.length-match[0].length;
      }
      //add the html that comes after this, up until the next template syntax match thing
      rendered += template_contents.slice(match.index+match[0].length, matches[index+1]?.index ? matches[index+1].index : template_contents.length);
      index++;
      _iterations++;
    }
    return rendered;
  }

  render_template(template_name: string, vars?: any, recursion_layer: number=0): string {
    let path_to_template: string = Renderer.concat_path(this.templates_dir, template_name);
    const template_contents: string = readFileSync(path_to_template, "utf-8");
    return this.render(template_contents, vars, recursion_layer);
  }
}
